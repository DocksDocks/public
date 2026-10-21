/**
 * Safe sweep of agent leftovers. `planTidy` lists what can go: merged idle
 * linked worktrees and their containers, containers of gone or idle agent
 * directories, orphaned processes in agent directories, and idle scratch
 * entries. `applyTidy` performs a plan under a lock file. Each check fails
 * closed: a candidate that a check cannot prove safe stays, with its reason.
 */
import {
  appendFileSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
  type Stats,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { spawnProcess, type AsyncProcessResult } from "./exec";
import { ensureDirectory } from "./ompFileDeploy";
import { isSameOrInside, kitCacheDir, removeTemporaryPath } from "./scratch";
import { runBounded } from "./syncConcurrency";
import { acquireTidyLock, releaseTidyLock } from "./tidyLock";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
const WORKTREE_IDLE_MS = 24 * HOUR_MS;
/** Idle time of an agent directory before tidy stops its containers; also the orphan age. */
const STACK_IDLE_MS = 24 * HOUR_MS;
const SCRATCH_IDLE_MS = 7 * DAY_MS;
const LOG_ROTATE_BYTES = 262_144;

export const PROCESS_LIST_UNAVAILABLE = "process list unavailable";
const PROCESS_LIST_UNAVAILABLE_NOTE =
  "process list unavailable; kept every candidate that a running process could use";
const IN_USE = "in use by a running process";
const DOCKER_PS_FORMAT =
  '{{.ID}}\\t{{.State}}\\t{{.Label "com.docker.compose.project"}}\\t{{.Label "com.docker.compose.project.working_dir"}}';
/** Process names that tidy never stops: the agent harness, its launcher, and the kit. */
const PROTECTED_NAMES = ["omp", "tern", "docks-kit"] as const;

// ----------------------------------------------------------------- paths ----

/** The plan-lifecycle worktree root: `$XDG_DATA_HOME/agent-worktrees`. */
export function agentWorktreeRoot(home: string, env: NodeJS.ProcessEnv): string {
  const xdg = env["XDG_DATA_HOME"];
  const dataHome =
    xdg !== undefined && xdg !== "" && isAbsolute(xdg) ? xdg : join(home, ".local", "share");
  return join(dataHome, "agent-worktrees");
}

export function tidyLockPath(home: string): string {
  return join(kitCacheDir(home), "tidy.lock");
}

export function tidyLogPath(home: string): string {
  return join(kitCacheDir(home), "tidy.log");
}

/**
 * Resolve a path, then take its real path when it exists. Tidy compares only
 * these forms, so macOS `/private` and Windows drive spellings agree.
 */
export function normalizePath(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

// ------------------------------------------------------------------ host ----

export interface TidyProcess {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly missing: boolean;
}

export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly ageMs: number;
  readonly rssKb: number;
  readonly comm: string;
  readonly args: string;
  readonly cwd: string | undefined;
}

export interface TidyHost {
  readonly git: (args: ReadonlyArray<string>) => Promise<TidyProcess>;
  /**
   * Runs `docker <args>`. Tidy calls it only through `localDocker`, which puts
   * `--host <verified local endpoint>` first.
   */
  readonly docker: (args: ReadonlyArray<string>) => Promise<TidyProcess>;
  /**
   * Prints the endpoint that a plain docker command uses, after `DOCKER_HOST`,
   * `DOCKER_CONTEXT`, and the current context apply. It does not connect.
   */
  readonly dockerEndpoint: () => Promise<TidyProcess>;
  readonly run: (command: string, args: ReadonlyArray<string>) => Promise<TidyProcess>;
  /** `undefined` when the host cannot list processes with their working directories. */
  readonly processes: () => Promise<ReadonlyArray<ProcessRow> | undefined>;
  readonly now: () => number;
}

function errorCode(cause: unknown): string | undefined {
  return cause instanceof Error && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : undefined;
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isMissingCommand(result: AsyncProcessResult): boolean {
  const error = result.error;
  if (error === undefined) return false;
  return errorCode(error) === "ENOENT" || error.message.startsWith("command not found on PATH");
}

async function runTool(command: string, args: ReadonlyArray<string>): Promise<TidyProcess> {
  const result = await spawnProcess(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  const stderr =
    result.stderr === "" && result.error !== undefined ? result.error.message : result.stderr;
  return {
    code: result.exitCode,
    stdout: result.stdout,
    stderr,
    missing: isMissingCommand(result),
  };
}

/** First non-empty output line of a failed command, for a one-line reason. */
export function firstLine(result: TidyProcess): string {
  const line = [...result.stderr.split("\n"), ...result.stdout.split("\n")]
    .map((text) => text.trim())
    .find((text) => text !== "");
  if (line !== undefined) return line;
  return result.missing ? "command not found" : `exit ${String(result.code)}`;
}

/** The file name of `comm`; macOS `ps` prints the full executable path there. */
export function commandName(comm: string): string {
  return comm.split("/").at(-1) ?? comm;
}

interface PsFields {
  readonly ppid: number;
  readonly ageMs: number;
  readonly rssKb: number;
  readonly args: string;
}

/** Parse `pid ppid age rss args` rows; `undefined` when a row does not parse. */
function parsePsFields(
  stdout: string,
  parseAge: (text: string) => number | undefined,
): Map<number, PsFields> | undefined {
  const rows = new Map<number, PsFields>();
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)(?:\s+(.*))?$/.exec(line);
    if (match === null) return undefined;
    const ageMs = parseAge(match[3]!);
    if (ageMs === undefined) return undefined;
    rows.set(Number(match[1]), {
      ppid: Number(match[2]),
      ageMs,
      rssKb: Number(match[4]),
      args: (match[5] ?? "").trim(),
    });
  }
  return rows.size === 0 ? undefined : rows;
}

/** Parse `pid comm` rows; `comm` is the last column, so it may hold spaces. */
function parsePsNames(stdout: string): Map<number, string> | undefined {
  const names = new Map<number, string>();
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    const match = /^\s*(\d+)\s(.*)$/.exec(line);
    if (match === null) return undefined;
    names.set(Number(match[1]), match[2]!.trim());
  }
  return names.size === 0 ? undefined : names;
}

/** Parse the macOS `etime` form `[[dd-]hh:]mm:ss` into milliseconds. */
export function parseElapsed(text: string): number | undefined {
  const match = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(text);
  if (match === null) return undefined;
  const [d, h, m, s] = [match[1], match[2], match[3], match[4]].map((part) =>
    part === undefined ? 0 : Number(part),
  );
  return (((d! * 24 + h!) * 60 + m!) * 60 + s!) * 1000;
}

function parseSeconds(text: string): number | undefined {
  return /^\d+$/.test(text) ? Number(text) * 1000 : undefined;
}

/** Parse `lsof -Fpn` output: a `p<pid>` line, then the `n<path>` line of its cwd. */
function parseLsofCwd(stdout: string): Map<number, string> | undefined {
  const cwds = new Map<number, string>();
  let pid: number | undefined;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("p")) {
      if (!/^p\d+$/.test(line)) return undefined;
      pid = Number(line.slice(1));
    } else if (line.startsWith("n") && pid !== undefined) {
      cwds.set(pid, line.slice(1));
    }
  }
  return cwds;
}

/** A `ps` row before its working directory is read. */
export type ListedProcess = Omit<ProcessRow, "cwd">;

/** One read of a process working directory. */
export type CwdProbe =
  | { readonly kind: "cwd"; readonly path: string }
  | { readonly kind: "exited" }
  | { readonly kind: "unreadable" };

/**
 * Processes that the kernel often keeps from a `cwd` read (the user service
 * manager and setgid agents). They never work in an agent directory.
 */
const UNREADABLE_CWD_NAMES: ReadonlyArray<string> = [
  "systemd",
  "(sd-pam)",
  "ssh-agent",
  "gpg-agent",
];

/**
 * Attach each working directory. A process that exited during the probe is
 * dropped. A known agent or service manager with an unreadable cwd stays with
 * `cwd: undefined`: it keeps its PID, so `orphanParents` still finds the
 * `systemd` subreaper, and it protects no directory. Any other unreadable cwd
 * returns `undefined`, because that process could use an agent directory.
 */
export function resolveProcessCwds(
  rows: ReadonlyArray<ListedProcess>,
  readCwd: (pid: number) => CwdProbe,
): ReadonlyArray<ProcessRow> | undefined {
  const resolved: Array<ProcessRow> = [];
  for (const row of rows) {
    const probe = readCwd(row.pid);
    if (probe.kind === "exited") continue;
    if (probe.kind === "cwd") {
      resolved.push({ ...row, cwd: probe.path });
      continue;
    }
    // Linux `comm` is the name cut to 15 characters; macOS `comm` is the full path.
    const known =
      UNREADABLE_CWD_NAMES.includes(row.comm) ||
      UNREADABLE_CWD_NAMES.includes(commandName(row.comm));
    if (!known) return undefined;
    resolved.push({ ...row, cwd: undefined });
  }
  return resolved;
}

/**
 * Join the two `ps` reads by PID. Two reads keep `comm` unambiguous: as the
 * last column it may hold spaces (Linux `omp daemon brok`, a macOS app path).
 */
function joinRows(
  fields: Map<number, PsFields> | undefined,
  names: Map<number, string> | undefined,
): Array<ListedProcess> | undefined {
  if (fields === undefined || names === undefined) return undefined;
  const rows: Array<ListedProcess> = [];
  for (const [pid, row] of fields) {
    const comm = names.get(pid);
    if (comm === undefined || pid === process.pid) continue;
    rows.push({ pid, ...row, comm });
  }
  return rows;
}

/** `readlink /proc/<pid>/cwd`; ENOENT or ESRCH means that the process exited. */
function readLinuxCwd(pid: number): CwdProbe {
  try {
    return { kind: "cwd", path: readlinkSync(`/proc/${pid}/cwd`) };
  } catch (cause) {
    const code = errorCode(cause);
    return code === "ENOENT" || code === "ESRCH" ? { kind: "exited" } : { kind: "unreadable" };
  }
}

async function linuxProcesses(uid: number): Promise<ReadonlyArray<ProcessRow> | undefined> {
  const user = ["-u", String(uid)];
  const [fields, names] = await Promise.all([
    runTool("ps", [...user, "-o", "pid=,ppid=,etimes=,rss=,args="]),
    runTool("ps", [...user, "-o", "pid=,comm="]),
  ]);
  if (fields.code !== 0 || names.code !== 0) return undefined;
  const rows = joinRows(parsePsFields(fields.stdout, parseSeconds), parsePsNames(names.stdout));
  return rows === undefined ? undefined : resolveProcessCwds(rows, readLinuxCwd);
}

async function darwinProcesses(uid: number): Promise<ReadonlyArray<ProcessRow> | undefined> {
  const user = ["-x", "-U", String(uid)];
  const [fields, names, lsof] = await Promise.all([
    runTool("ps", [...user, "-o", "pid=,ppid=,etime=,rss=,args="]),
    runTool("ps", [...user, "-o", "pid=,comm="]),
    runTool("lsof", ["-nP", "-a", "-u", String(uid), "-d", "cwd", "-Fpn"]),
  ]);
  if (fields.code !== 0 || names.code !== 0 || lsof.code !== 0) return undefined;
  const cwds = parseLsofCwd(lsof.stdout);
  const rows = joinRows(parsePsFields(fields.stdout, parseElapsed), parsePsNames(names.stdout));
  if (cwds === undefined || rows === undefined) return undefined;
  // A PID without an `lsof` cwd exited (ESRCH) or is alive but unreadable (EPERM).
  return resolveProcessCwds(rows, (pid) => {
    const cwd = cwds.get(pid);
    if (cwd !== undefined) return { kind: "cwd", path: cwd };
    try {
      process.kill(pid, 0);
    } catch (cause) {
      if (errorCode(cause) === "ESRCH") return { kind: "exited" };
    }
    return { kind: "unreadable" };
  });
}

async function listProcesses(): Promise<ReadonlyArray<ProcessRow> | undefined> {
  const uid = process.getuid?.();
  if (uid === undefined) return undefined;
  if (process.platform === "linux") return linuxProcesses(uid);
  if (process.platform === "darwin") return darwinProcesses(uid);
  return undefined;
}

export function defaultTidyHost(): TidyHost {
  return {
    git: (args) => runTool("git", args),
    docker: (args) => runTool("docker", args),
    dockerEndpoint: () =>
      runTool("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]),
    run: runTool,
    processes: listProcesses,
    now: () => Date.now(),
  };
}

/** PIDs that adopt orphans: init (1) and each user `systemd` subreaper. */
export function orphanParents(rows: ReadonlyArray<ProcessRow>): ReadonlySet<number> {
  const parents = new Set<number>([1]);
  for (const row of rows) if (commandName(row.comm) === "systemd") parents.add(row.pid);
  return parents;
}

// ---------------------------------------------------------------- docker ----

/**
 * True only for a local daemon socket: `unix:///<absolute path>`, or the
 * Windows pipe `npipe:////./pipe/<name>` on the local server `.`. A compose
 * label inside agent territory does not prove a local daemon, because
 * `DOCKER_HOST` or a context can send a plain docker command to another host.
 */
export function isLocalDockerEndpoint(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || char === "\\") return false;
  }
  return /^unix:\/\/\/.+$/.test(value) || /^npipe:\/\/\/\/\.\/pipe\/[^/]+$/.test(value);
}

/** How tidy may reach Docker in one run. Only `local` permits a Docker call. */
export type DockerAccess =
  | { readonly kind: "local"; readonly endpoint: string }
  | { readonly kind: "missing"; readonly reason: string }
  | { readonly kind: "not-local"; readonly endpoint: string };

/** Resolve the effective endpoint once per run; the plan carries it to the apply. */
export async function resolveDockerAccess(host: TidyHost): Promise<DockerAccess> {
  const result = await host.dockerEndpoint();
  if (result.missing) return { kind: "missing", reason: firstLine(result) };
  const endpoint = result.code === 0 ? result.stdout.trim() : "";
  return isLocalDockerEndpoint(endpoint)
    ? { kind: "local", endpoint }
    : { kind: "not-local", endpoint };
}

export function notLocalMessage(endpoint: string): string {
  return `docker endpoint ${endpoint === "" ? "<empty>" : endpoint} is not local`;
}

export type DockerRunner = (args: ReadonlyArray<string>) => Promise<TidyProcess>;

/**
 * The only path from tidy to a Docker call. It checks the endpoint again and
 * puts `--host <endpoint>` first; `undefined` unless the endpoint is local.
 */
export function localDocker(host: TidyHost, access: DockerAccess): DockerRunner | undefined {
  if (access.kind !== "local" || !isLocalDockerEndpoint(access.endpoint)) return undefined;
  const endpoint = access.endpoint;
  return (args) => host.docker(["--host", endpoint, ...args]);
}

// ------------------------------------------------------------ plan model ----

export type TidyAction =
  | {
      readonly kind: "remove-worktree";
      readonly path: string;
      readonly repo: string;
      readonly containerIds: ReadonlyArray<string>;
      readonly projects: ReadonlyArray<string>;
      readonly reason: string;
    }
  | {
      readonly kind: "stop-containers";
      readonly project: string;
      readonly workingDir: string;
      readonly ids: ReadonlyArray<string>;
      readonly reason: string;
    }
  | {
      readonly kind: "remove-containers";
      readonly project: string;
      readonly workingDir: string;
      readonly ids: ReadonlyArray<string>;
      readonly reason: string;
    }
  | {
      readonly kind: "stop-process";
      readonly pid: number;
      readonly args: string;
      readonly cwd: string;
      readonly reason: string;
    }
  | { readonly kind: "remove-scratch"; readonly path: string; readonly reason: string };

export interface TidyKept {
  readonly subject: string;
  readonly reason: string;
}

export interface TidyPlan {
  readonly actions: ReadonlyArray<TidyAction>;
  readonly kept: ReadonlyArray<TidyKept>;
  readonly notes: ReadonlyArray<string>;
  /** The Docker access that listed the containers; `applyTidy` uses the same endpoint. */
  readonly docker: DockerAccess;
}

export interface TidyInputs {
  readonly home: string;
  readonly worktreeRoot: string;
  readonly scratchRoot: string;
  readonly repo?: string;
}

export function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The word that a plan line starts with: `remove` or `stop`. */
export function actionVerb(action: TidyAction): "remove" | "stop" {
  return action.kind === "stop-containers" || action.kind === "stop-process" ? "stop" : "remove";
}

export function actionSubject(action: TidyAction): string {
  switch (action.kind) {
    case "remove-worktree":
      return action.containerIds.length === 0
        ? `worktree ${action.path}`
        : `worktree ${action.path} with ${plural(action.containerIds.length, "container")}`;
    case "stop-containers":
    case "remove-containers":
      return `${plural(action.ids.length, "container")} of ${action.project || "(no project)"} in ${action.workingDir}`;
    case "stop-process":
      return `process ${action.pid} (${shorten(action.args, 80)}) in ${action.cwd}`;
    case "remove-scratch":
      return `scratch ${action.path}`;
  }
}

// ------------------------------------------------------------ roots guard ----

interface AgentRoots {
  readonly worktreeRoot: string | undefined;
  readonly scratchRoot: string | undefined;
  readonly home: string;
  readonly notes: ReadonlyArray<string>;
}

/** Normalize both roots and drop a root that equals or contains the home directory. */
export function agentRoots(inputs: TidyInputs): AgentRoots {
  const home = normalizePath(inputs.home);
  const notes: Array<string> = [];
  const guard = (root: string): string | undefined => {
    const path = normalizePath(root);
    if (!isSameOrInside(path, home)) return path;
    notes.push(`refusing root ${path}: it contains the home directory`);
    return undefined;
  };
  return {
    worktreeRoot: guard(inputs.worktreeRoot),
    scratchRoot: guard(inputs.scratchRoot),
    home,
    notes,
  };
}

// -------------------------------------------------------------- worktrees ----

export interface WorktreeCandidate {
  readonly path: string;
  /** The admin directory that the `.git` file names; `undefined` when it names none. */
  readonly admin: string | undefined;
}

export interface WorktreeListing {
  readonly candidates: ReadonlyArray<WorktreeCandidate>;
  readonly kept: ReadonlyArray<TidyKept>;
  readonly notes: ReadonlyArray<string>;
}

export function lstatOrUndefined(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

export function sortedEntries(directory: string): Array<string> {
  try {
    return readdirSync(directory).sort();
  } catch {
    return [];
  }
}

/** The admin directory from a `gitdir: <path>` file at `<worktree>/.git`. */
function adminDirectory(worktree: string): string | undefined {
  try {
    const text = readFileSync(join(worktree, ".git"), "utf8");
    if (!text.startsWith("gitdir: ")) return undefined;
    return normalizePath(resolve(worktree, text.slice("gitdir: ".length).trim()));
  } catch {
    return undefined;
  }
}

/**
 * Scan `<root>/<a>` and `<root>/<a>/<b>` with `lstat`. Never follow a symbolic
 * link, and never descend into a directory that has a `.git` entry.
 */
function scanWorktreeRoot(root: string): {
  readonly candidates: Array<WorktreeCandidate>;
  readonly kept: Array<TidyKept>;
} {
  const candidates: Array<WorktreeCandidate> = [];
  const kept: Array<TidyKept> = [];
  const visit = (directory: string, depth: number): void => {
    for (const entry of sortedEntries(directory)) {
      const path = join(directory, entry);
      if (lstatOrUndefined(path)?.isDirectory() !== true) continue;
      const marker = lstatOrUndefined(join(path, ".git"));
      if (marker === undefined) {
        if (depth === 0) visit(path, 1);
        continue;
      }
      const admin = marker.isFile() ? adminDirectory(path) : undefined;
      if (admin === undefined)
        kept.push({ subject: `directory ${path}`, reason: "not a linked worktree" });
      else candidates.push({ path, admin });
    }
  };
  visit(root, 0);
  return { candidates, kept };
}

/** One entry of `git worktree list --porcelain`. */
export interface WorktreeEntry {
  readonly path: string;
  readonly prunable: boolean;
  /** The checked-out branch ref, `refs/heads/<name>`; `undefined` when detached or bare. */
  readonly branch: string | undefined;
}

function parseWorktreeList(stdout: string): Array<WorktreeEntry> {
  return stdout
    .split(/\r?\n\r?\n/)
    .map((block) => block.split(/\r?\n/).filter((line) => line !== ""))
    .filter((lines) => lines.length > 0 && lines[0]!.startsWith("worktree "))
    .map((lines) => ({
      path: normalizePath(lines[0]!.slice("worktree ".length)),
      prunable: lines.some((line) => line === "prunable" || line.startsWith("prunable ")),
      branch: lines.find((line) => line.startsWith("branch "))?.slice("branch ".length),
    }));
}

/** Every worktree entry of a repository, the main worktree first. */
export async function repositoryWorktrees(
  repo: string,
  host: TidyHost,
): Promise<ReadonlyArray<WorktreeEntry> | undefined> {
  const result = await host.git(["-C", repo, "worktree", "list", "--porcelain"]);
  return result.code === 0 ? parseWorktreeList(result.stdout) : undefined;
}

/**
 * Worktree candidates (rule 4): a scan of the worktree root by default, or the
 * linked worktrees of `inputs.repo`, at any location.
 */
export async function listWorktreeCandidates(
  inputs: TidyInputs,
  host: TidyHost,
): Promise<WorktreeListing> {
  if (inputs.repo !== undefined) {
    const entries = await repositoryWorktrees(inputs.repo, host);
    if (entries === undefined) {
      return { candidates: [], kept: [], notes: [`git worktree list failed in ${inputs.repo}`] };
    }
    const candidates = entries
      .slice(1)
      .filter((entry) => !entry.prunable)
      .map((entry) => ({ path: entry.path, admin: adminDirectory(entry.path) }));
    return { candidates, kept: [], notes: [] };
  }
  const root = agentRoots(inputs).worktreeRoot;
  if (root === undefined) return { candidates: [], kept: [], notes: [] };
  if (lstatOrUndefined(root)?.isDirectory() !== true) {
    return { candidates: [], kept: [], notes: [`worktree root ${root} does not exist`] };
  }
  return { ...scanWorktreeRoot(root), notes: [] };
}

/** The default branch ref: `origin/HEAD`, else `origin/main`, else `origin/master`. */
export async function defaultBranchRef(
  directory: string,
  host: TidyHost,
): Promise<string | undefined> {
  const symbolic = await host.git([
    "-C",
    directory,
    "symbolic-ref",
    "--quiet",
    "refs/remotes/origin/HEAD",
  ]);
  const refs = ["refs/remotes/origin/main", "refs/remotes/origin/master"];
  if (symbolic.code === 0 && symbolic.stdout.trim() !== "") refs.unshift(symbolic.stdout.trim());
  for (const ref of refs) {
    const verify = await host.git([
      "-C",
      directory,
      "rev-parse",
      "--verify",
      "--quiet",
      `${ref}^{commit}`,
    ]);
    if (verify.code === 0) return ref;
  }
  return undefined;
}

export function shortRef(ref: string): string {
  return ref.replace(/^refs\/(remotes|heads)\//, "");
}

interface GitLocation {
  /** The common git directory, normalized. */
  readonly common: string;
  /** The parent of `common`, or `common` itself for a bare repository. */
  readonly repo: string;
}

async function gitLocation(directory: string, host: TidyHost): Promise<GitLocation | undefined> {
  const result = await host.git([
    "-C",
    directory,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  if (result.code !== 0 || result.stdout.trim() === "") return undefined;
  const common = normalizePath(result.stdout.trim());
  return { common, repo: basename(common) === ".git" ? dirname(common) : common };
}

/** The main repository of any checkout or worktree of it; `undefined` outside git. */
export async function mainRepository(
  directory: string,
  host: TidyHost,
): Promise<string | undefined> {
  return (await gitLocation(directory, host))?.repo;
}

/**
 * The main repository of a linked worktree. `undefined` unless the admin
 * directory lies in `<common>/worktrees`, so a submodule never matches.
 */
export async function worktreeRepository(
  worktree: string,
  admin: string,
  host: TidyHost,
): Promise<string | undefined> {
  const location = await gitLocation(worktree, host);
  if (location === undefined) return undefined;
  const expected = normalizePath(join(location.common, "worktrees"));
  return normalizePath(dirname(admin)) === expected ? location.repo : undefined;
}

/**
 * `lstat` with three outcomes: the stats; `undefined` when the path is absent
 * (ENOENT or ENOTDIR); or a thrown `cannot check <path>: <code>` for any other
 * error. An unknown state never counts as absent, so it never permits an action.
 */
function lstatIfPresent(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (cause) {
    const code = errorCode(cause);
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw new Error(`cannot check ${path}: ${code ?? errorMessage(cause)}`, { cause });
  }
}

/** Latest `lstat` mtime of the paths that exist; `undefined` when none exists. */
function latestMtime(paths: ReadonlyArray<string>): number | undefined {
  let latest: number | undefined;
  for (const path of paths) {
    const stats = lstatIfPresent(path);
    if (stats !== undefined && (latest === undefined || stats.mtimeMs > latest)) {
      latest = stats.mtimeMs;
    }
  }
  return latest;
}

/** Latest mtime of a scratch entry and its immediate children; it throws when unknown. */
function entryActivity(path: string): number | undefined {
  const stats = lstatIfPresent(path);
  if (stats === undefined) return undefined;
  if (!stats.isDirectory()) return stats.mtimeMs;
  let children: Array<string>;
  try {
    children = readdirSync(path);
  } catch (cause) {
    throw new Error(`cannot check ${path}: ${errorCode(cause) ?? errorMessage(cause)}`, {
      cause,
    });
  }
  return latestMtime([path, ...children.map((entry) => join(path, entry))]);
}

/**
 * Paths that `git status --porcelain -z` lists, resolved against the worktree.
 * Each entry is `XY <path>` and a NUL; a rename or copy entry has its source
 * path as a second NUL-terminated field. Git does not quote names in this form.
 */
function changedPaths(worktree: string, stdout: string): Array<string> {
  const fields = stdout.split("\0");
  const paths: Array<string> = [];
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index]!;
    if (entry.length < 4) continue;
    paths.push(resolve(worktree, entry.slice(3)));
    if (/[RC]/.test(entry.slice(0, 2))) index += 1;
  }
  return paths;
}

interface InspectedWorktree {
  readonly path: string;
  readonly repo: string | undefined;
  /** Latest activity for the stack rule: admin files plus the changed paths. */
  readonly stackActivity: number | undefined;
  readonly verdict: { readonly remove: boolean; readonly reason: string };
}

interface PlanContext {
  readonly home: string;
  readonly now: number;
  readonly inUse: ReadonlyArray<string> | undefined;
  readonly host: TidyHost;
}

function hours(ms: number): number {
  return Math.max(0, Math.floor(ms / HOUR_MS));
}

function days(ms: number): number {
  return Math.max(0, Math.floor(ms / DAY_MS));
}

/** Why a running process blocks `path`, or `undefined` when nothing uses it. */
function inUseReason(path: string, inUse: ReadonlyArray<string> | undefined): string | undefined {
  if (inUse === undefined) return PROCESS_LIST_UNAVAILABLE;
  return inUse.some((cwd) => isSameOrInside(path, cwd)) ? IN_USE : undefined;
}

/** Candidate checks (rule 5); a path that tidy cannot check keeps the worktree. */
async function inspectWorktree(
  candidate: WorktreeCandidate,
  context: PlanContext,
): Promise<InspectedWorktree> {
  try {
    return await checkWorktree(candidate, context);
  } catch (cause) {
    return {
      path: candidate.path,
      repo: undefined,
      stackActivity: undefined,
      verdict: { remove: false, reason: errorMessage(cause) },
    };
  }
}

/** The checks in order; the first failed check keeps the worktree. */
async function checkWorktree(
  candidate: WorktreeCandidate,
  context: PlanContext,
): Promise<InspectedWorktree> {
  const { path, admin } = candidate;
  const { host, now } = context;
  const keep = (reason: string, stackActivity?: number): InspectedWorktree => ({
    path,
    repo: undefined,
    stackActivity,
    verdict: { remove: false, reason },
  });
  if (isSameOrInside(path, context.home)) return keep("contains the home directory");
  if (admin === undefined || lstatIfPresent(admin) === undefined) {
    return keep("main repository is missing");
  }
  const adminFiles = [join(admin, "HEAD"), join(admin, "index"), join(admin, "logs", "HEAD")];
  const activity = latestMtime(adminFiles) ?? lstatIfPresent(path)?.mtimeMs;
  const status = await host.git(["-C", path, "--no-optional-locks", "status", "--porcelain", "-z"]);
  const changed = status.code === 0 ? changedPaths(path, status.stdout) : [];
  const latest = latestMtime([...adminFiles, ...changed]) ?? activity;
  if (lstatIfPresent(join(admin, "locked")) !== undefined) return keep("locked", latest);
  if (status.code !== 0) return keep(`git status failed: ${firstLine(status)}`, latest);
  if (changed.length > 0) return keep("has changes", latest);
  const ref = await defaultBranchRef(path, host);
  if (ref === undefined) return keep("no remote default branch", latest);
  const merged = await host.git(["-C", path, "merge-base", "--is-ancestor", "HEAD", ref]);
  if (merged.code !== 0) return keep(`not merged into ${shortRef(ref)}`, latest);
  const idle = activity === undefined ? 0 : now - activity;
  if (idle < WORKTREE_IDLE_MS) return keep(`active ${hours(idle)} h ago`, latest);
  const blocked = inUseReason(path, context.inUse);
  if (blocked !== undefined) return keep(blocked, latest);
  const repo = await worktreeRepository(path, admin, host);
  if (repo === undefined) return keep("not a linked worktree", latest);
  return {
    path,
    repo,
    stackActivity: latest,
    verdict: { remove: true, reason: `merged into ${shortRef(ref)}, idle ${hours(idle)} h` },
  };
}

// ------------------------------------------------------------- containers ----

interface ContainerRow {
  readonly id: string;
  readonly state: string;
  readonly project: string;
  readonly workingDir: string;
}

function parseContainerRows(stdout: string): Array<ContainerRow> {
  const rows: Array<ContainerRow> = [];
  for (const line of stdout.split("\n")) {
    const [id = "", state = "", project = "", workingDir = ""] = line.trim().split("\t");
    if (id === "" || workingDir.trim() === "") continue;
    rows.push({ id, state, project, workingDir: normalizePath(workingDir.trim()) });
  }
  return rows;
}

/** The first-level scratch entry that holds `path`, or `undefined`. */
function scratchEntryOf(scratchRoot: string | undefined, path: string): string | undefined {
  if (scratchRoot === undefined || !isSameOrInside(scratchRoot, path)) return undefined;
  const [first] = relative(scratchRoot, path).split(/[\\/]/);
  return first === undefined || first === "" ? undefined : join(scratchRoot, first);
}

// ------------------------------------------------------------------ plan ----

/** Build the sweep plan. Read-only: it runs only listing commands. */
export async function planTidy(inputs: TidyInputs, host: TidyHost): Promise<TidyPlan> {
  const roots = agentRoots(inputs);
  const notes: Array<string> = [...roots.notes];
  const kept: Array<TidyKept> = [];
  const now = host.now();
  const rows = await host.processes();
  if (rows === undefined) notes.push(PROCESS_LIST_UNAVAILABLE_NOTE);
  const inUse =
    rows === undefined
      ? undefined
      : rows.flatMap((row) => (row.cwd === undefined ? [] : [normalizePath(row.cwd)]));
  const context: PlanContext = { home: roots.home, now, inUse, host };

  const listing = await listWorktreeCandidates(inputs, host);
  kept.push(...listing.kept);
  notes.push(...listing.notes);
  const inspected = await runBounded(
    listing.candidates.map((candidate) => () => inspectWorktree(candidate, context)),
    3,
  );
  const removals = new Map<
    string,
    { repo: string; reason: string; containerIds: Array<string>; projects: Array<string> }
  >();
  for (const worktree of inspected) {
    if (worktree.verdict.remove && worktree.repo !== undefined) {
      removals.set(worktree.path, {
        repo: worktree.repo,
        reason: worktree.verdict.reason,
        containerIds: [],
        projects: [],
      });
    } else {
      kept.push({ subject: `worktree ${worktree.path}`, reason: worktree.verdict.reason });
    }
  }

  const stopContainers: Array<TidyAction> = [];
  const removeContainers: Array<TidyAction> = [];
  const docker = await resolveDockerAccess(host);
  const runDocker = localDocker(host, docker);
  // A worktree with an unknown container list stays: removing it could leave
  // a running stack without its directory. A host without docker has no stack.
  let containersUnknown: string | undefined;
  if (docker.kind === "missing") {
    notes.push(`docker unavailable: ${docker.reason}`);
  } else if (runDocker === undefined) {
    notes.push(`${notLocalMessage(docker.endpoint)}; skipped container rules`);
    containersUnknown = "docker endpoint not local";
  } else {
    const listed = await runDocker(["ps", "-a", "--no-trunc", "--format", DOCKER_PS_FORMAT]);
    if (listed.code !== 0) {
      notes.push(`docker unavailable: ${firstLine(listed)}`);
      containersUnknown = "container list unavailable";
    }
    const territory = [
      roots.worktreeRoot,
      roots.scratchRoot,
      ...(inputs.repo === undefined ? [] : listing.candidates.map((candidate) => candidate.path)),
    ].filter((path): path is string => path !== undefined);
    const groups = new Map<string, Array<ContainerRow>>();
    for (const row of listed.code === 0 ? parseContainerRows(listed.stdout) : []) {
      const key = `${row.project}\0${row.workingDir}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const group of groups.values()) {
      const { project, workingDir } = group[0]!;
      const subject = `containers of ${project || "(no project)"} in ${workingDir}`;
      const ids = group.map((row) => row.id);
      const removal = [...removals].find(([path]) => isSameOrInside(path, workingDir))?.[1];
      if (removal !== undefined) {
        removal.containerIds.push(...ids);
        if (project !== "" && !removal.projects.includes(project)) removal.projects.push(project);
        continue;
      }
      if (!territory.some((root) => isSameOrInside(root, workingDir))) continue;
      // Only a path that `lstat` reports absent is gone; an unknown state keeps the rows.
      let present: boolean;
      try {
        present = lstatIfPresent(workingDir) !== undefined;
      } catch (cause) {
        notes.push(errorMessage(cause));
        continue;
      }
      if (!present) {
        removeContainers.push({
          kind: "remove-containers",
          project,
          workingDir,
          ids,
          reason: "directory is gone",
        });
        continue;
      }
      const running = group.filter((row) => row.state === "running").map((row) => row.id);
      if (running.length === 0) continue;
      const worktree = inspected.find((entry) => isSameOrInside(entry.path, workingDir));
      const owner = worktree?.path ?? scratchEntryOf(roots.scratchRoot, workingDir);
      if (owner === undefined) {
        kept.push({ subject, reason: "not in a linked worktree or a scratch entry" });
        continue;
      }
      let activity: number | undefined;
      try {
        activity = worktree !== undefined ? worktree.stackActivity : entryActivity(owner);
      } catch (cause) {
        kept.push({ subject, reason: errorMessage(cause) });
        continue;
      }
      if (activity === undefined) {
        kept.push({ subject, reason: "idle time unknown" });
        continue;
      }
      const idle = now - activity;
      if (idle < STACK_IDLE_MS) {
        kept.push({ subject, reason: `active ${hours(idle)} h ago` });
        continue;
      }
      const blocked = inUseReason(owner, inUse);
      if (blocked !== undefined) {
        kept.push({ subject, reason: blocked });
        continue;
      }
      stopContainers.push({
        kind: "stop-containers",
        project,
        workingDir,
        ids: running,
        reason: `idle ${hours(idle)} h`,
      });
    }
  }
  if (containersUnknown !== undefined) {
    for (const path of removals.keys()) {
      kept.push({ subject: `worktree ${path}`, reason: containersUnknown });
    }
    removals.clear();
  }

  const stopProcesses: Array<TidyAction> = [];
  if (rows !== undefined) {
    const parents = orphanParents(rows);
    const processRoots = [roots.worktreeRoot, roots.scratchRoot].filter(
      (path): path is string => path !== undefined,
    );
    for (const row of rows) {
      if (!parents.has(row.ppid) || row.ageMs < STACK_IDLE_MS || row.cwd === undefined) continue;
      if (isProtectedProcess(row)) continue;
      const cwd = normalizePath(row.cwd);
      if (!processRoots.some((root) => isSameOrInside(root, cwd))) continue;
      stopProcesses.push({
        kind: "stop-process",
        pid: row.pid,
        args: row.args,
        cwd,
        reason: `orphaned for ${hours(row.ageMs)} h`,
      });
    }
  }

  const removeScratch: Array<TidyAction> = [];
  const scratch = roots.scratchRoot;
  if (scratch !== undefined && lstatOrUndefined(scratch)?.isDirectory() === true) {
    for (const entry of sortedEntries(scratch)) {
      const path = join(scratch, entry);
      const subject = `scratch ${path}`;
      let activity: number | undefined;
      try {
        if (lstatIfPresent(path)?.isSymbolicLink() === true) {
          kept.push({ subject, reason: "is a symbolic link" });
          continue;
        }
        activity = entryActivity(path);
      } catch (cause) {
        kept.push({ subject, reason: errorMessage(cause) });
        continue;
      }
      if (activity === undefined) continue;
      const idle = now - activity;
      if (idle < SCRATCH_IDLE_MS) {
        kept.push({ subject, reason: `active ${hours(idle)} h ago` });
        continue;
      }
      const blocked = inUseReason(path, inUse);
      if (blocked !== undefined) {
        kept.push({ subject, reason: blocked });
        continue;
      }
      removeScratch.push({ kind: "remove-scratch", path, reason: `idle ${days(idle)} d` });
    }
  }

  const removeWorktrees: Array<TidyAction> = [...removals].map(([path, removal]) => ({
    kind: "remove-worktree",
    path,
    ...removal,
  }));
  return {
    actions: [
      ...stopProcesses,
      ...removeWorktrees,
      ...stopContainers,
      ...removeContainers,
      ...removeScratch,
    ],
    kept,
    notes,
    docker,
  };
}

/**
 * True for the agent harness, its launcher, and the kit: by process name, and
 * by an argument path under `/.omp/` or `/tern/` (omp workers and plugins).
 */
export function isProtectedProcess(row: ProcessRow): boolean {
  const name = commandName(row.comm);
  if (
    PROTECTED_NAMES.some(
      (protectedName) => name === protectedName || name.startsWith(`${protectedName} `),
    )
  ) {
    return true;
  }
  return row.args.includes("/.omp/") || row.args.includes("/tern/");
}

// ----------------------------------------------------------------- apply ----

function appendLog(log: string, lines: ReadonlyArray<string>, now: number): void {
  if (lines.length === 0) return;
  try {
    if (statSync(log).size > LOG_ROTATE_BYTES) renameSync(log, `${log}.1`);
  } catch (cause) {
    if (errorCode(cause) !== "ENOENT") throw cause;
  }
  const stamp = new Date(now).toISOString();
  appendFileSync(log, lines.map((line) => `${stamp} ${line}\n`).join(""), { mode: 0o600 });
}

async function removeProjectNetworks(
  projects: ReadonlyArray<string>,
  runDocker: DockerRunner,
): Promise<void> {
  for (const project of projects) {
    const list = await runDocker([
      "network",
      "ls",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${project}`,
    ]);
    const ids =
      list.code === 0
        ? list.stdout
            .split("\n")
            .map((id) => id.trim())
            .filter((id) => id !== "")
        : [];
    // A network that another container still uses stays; that failure is not a tidy failure.
    if (ids.length > 0) await runDocker(["network", "rm", ...ids]);
  }
}

/**
 * Perform a plan under the tidy lock. Order: stop processes, remove worktrees
 * (their containers first), prune each touched repository, stop containers,
 * remove containers, remove scratch entries. Never `git worktree remove --force`.
 * Every Docker call uses the endpoint that the plan verified.
 */
export async function applyTidy(
  plan: TidyPlan,
  inputs: TidyInputs,
  host: TidyHost,
): Promise<{
  readonly locked: boolean;
  readonly failures: number;
  readonly lines: ReadonlyArray<string>;
}> {
  ensureDirectory(kitCacheDir(inputs.home));
  const lockPath = tidyLockPath(inputs.home);
  const lock = acquireTidyLock(lockPath, host.now());
  if (lock === undefined) {
    return { locked: true, failures: 0, lines: [`another docks-kit tidy run holds ${lockPath}`] };
  }
  try {
    const lines: Array<string> = [];
    let failures = 0;
    const done = (outcome: "removed" | "stopped", subject: string): void => {
      lines.push(`${outcome} ${subject}`);
    };
    const failed = (subject: string, detail: string): void => {
      failures += 1;
      lines.push(`failed ${subject}: ${detail}`);
    };
    const byKind = <K extends TidyAction["kind"]>(kind: K) =>
      plan.actions.filter(
        (action): action is Extract<TidyAction, { kind: K }> => action.kind === kind,
      );

    for (const action of byKind("stop-process")) {
      const subject = actionSubject(action);
      try {
        process.kill(action.pid, "SIGTERM");
        done("stopped", subject);
      } catch (cause) {
        if (errorCode(cause) === "ESRCH") done("stopped", subject);
        else failed(subject, errorMessage(cause));
      }
    }
    // A container action without a verified local endpoint fails and changes nothing.
    const runDocker = localDocker(host, plan.docker);
    const noDocker =
      plan.docker.kind === "missing" ? "docker unavailable" : notLocalMessage(plan.docker.endpoint);

    const touched = new Set<string>();
    for (const action of byKind("remove-worktree")) {
      const subject = actionSubject(action);
      if (action.containerIds.length > 0) {
        if (runDocker === undefined) {
          failed(subject, noDocker);
          continue;
        }
        const removed = await runDocker(["rm", "--force", "--volumes", ...action.containerIds]);
        if (removed.code !== 0) {
          failed(subject, `docker rm: ${firstLine(removed)}`);
          continue;
        }
        await removeProjectNetworks(action.projects, runDocker);
      }
      touched.add(action.repo);
      const result = await host.git(["-C", action.repo, "worktree", "remove", "--", action.path]);
      if (result.code === 0) done("removed", subject);
      else failed(subject, firstLine(result));
    }
    for (const repo of touched) {
      const result = await host.git(["-C", repo, "worktree", "prune"]);
      if (result.code !== 0) failed(`worktree prune in ${repo}`, firstLine(result));
    }

    for (const action of byKind("stop-containers")) {
      if (runDocker === undefined) {
        failed(actionSubject(action), noDocker);
        continue;
      }
      const result = await runDocker(["stop", ...action.ids]);
      if (result.code === 0) done("stopped", actionSubject(action));
      else failed(actionSubject(action), firstLine(result));
    }

    for (const action of byKind("remove-containers")) {
      if (runDocker === undefined) {
        failed(actionSubject(action), noDocker);
        continue;
      }
      const result = await runDocker(["rm", "--force", "--volumes", ...action.ids]);
      if (result.code !== 0) {
        failed(actionSubject(action), firstLine(result));
        continue;
      }
      await removeProjectNetworks(action.project === "" ? [] : [action.project], runDocker);
      done("removed", actionSubject(action));
    }

    const scratch = agentRoots(inputs).scratchRoot;
    for (const action of byKind("remove-scratch")) {
      const subject = actionSubject(action);
      if (scratch === undefined) {
        failed(subject, "the scratch root is refused");
        continue;
      }
      let activity: number | undefined;
      try {
        activity = entryActivity(action.path);
      } catch (cause) {
        lines.push(`kept ${subject}: ${errorMessage(cause)}`);
        continue;
      }
      if (activity !== undefined && host.now() - activity < SCRATCH_IDLE_MS) {
        lines.push(`kept ${subject}: active ${hours(host.now() - activity)} h ago`);
        continue;
      }
      const outcome = removeTemporaryPath(action.path, [scratch], inputs.home);
      if (outcome.kind === "removed") done("removed", subject);
      else failed(subject, outcome.reason);
    }

    try {
      appendLog(tidyLogPath(inputs.home), lines, host.now());
    } catch (cause) {
      failed(`log ${tidyLogPath(inputs.home)}`, errorMessage(cause));
    }
    return { locked: false, failures, lines };
  } finally {
    releaseTidyLock(lock);
  }
}
