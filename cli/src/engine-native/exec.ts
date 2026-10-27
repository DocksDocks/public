/**
 * Child-process + PATH primitives. Golden rule: every external probe spawns
 * the intended binary with deterministic argv, and capture() mirrors command
 * substitution: stdout with trailing newlines stripped, empty on failure.
 */
import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
  type SpawnSyncOptions,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
} from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { delimiter, extname, isAbsolute, join } from "node:path";
import { hostOs, type HostOs, type Invocation } from "./os";

/** A tool this host cannot resolve, shaped like the failed spawn it replaces. */
const notFound = (command: string): SpawnSyncReturns<string> => ({
  pid: 0,
  output: [],
  stdout: "",
  stderr: "",
  status: null,
  signal: null,
  error: new Error(`command not found on PATH: ${command}`),
});

/**
 * Every synchronous child starts here, because two host facts must never be
 * separated from the argv they describe: a Windows shim invocation is only
 * correct with the verbatim-arguments flag, and a pathless name would let
 * CreateProcess search the parent's current directory before the system one.
 */
export const spawnHost = (
  command: string,
  args: ReadonlyArray<string>,
  overrides: SpawnSyncOptions = {},
  host: HostOs = hostOs(),
): SpawnSyncReturns<string> => {
  const resolvesSuffixes = host.executableSuffixes.some((suffix) => suffix !== "");
  const executablePath = resolvesSuffixes ? which(command, host.executableSuffixes) : command;
  if (executablePath === "") return notFound(command);
  let invocation: Invocation;
  try {
    invocation = host.invoke(executablePath, args);
  } catch (cause) {
    // A value this host cannot put on a command line at all. Print the encoder's
    // reason and exit, matching how a caller reports a failed child.
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    return process.exit(2);
  }
  const options: SpawnSyncOptionsWithStringEncoding = {
    stdio: ["ignore", "pipe", "pipe"],
    ...overrides,
    encoding: "utf8",
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  };
  return spawnSync(invocation.command, [...invocation.args], options);
};

/** Keep engine paths slash-separated so rendered output is host-stable. */
export function p(...parts: Array<string>): string {
  return parts.join("/");
}

export interface AsyncProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
  /** Set when `timeoutMs` expired before the child closed; the output is partial. */
  readonly timedOut?: true;
}

/**
 * One-line failure text for a warning. A harness CLI that wraps git puts its own
 * message first, and the first line alone is often only git's `Cloning into`
 * line. Keep the first line and add the first later `fatal:` or `error:` line,
 * or the last line when no such line exists, because the CLI can print more
 * text after git's error.
 */
export function processFailureSummary(result: AsyncProcessResult): string {
  const lines = [...result.stdout.split("\n"), ...result.stderr.split("\n")]
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const [first, ...rest] = lines;
  if (first === undefined) return result.error?.message ?? "unknown error";
  const cause = rest.find((line) => /^(fatal|error):/i.test(line)) ?? rest.at(-1);
  return cause === undefined ? first : `${first} | ${cause}`;
}

export interface AsyncProcessOptions {
  readonly stdio?: SpawnOptions["stdio"];
  /** Working directory for the child; the parent's when absent. */
  readonly cwd?: string;
  /** Host whose executable resolution and argv shaping apply; tests inject it. */
  readonly host?: HostOs;
  /**
   * Kill the child and resolve with `timedOut` when it does not close within
   * this many milliseconds. No limit when absent.
   */
  readonly timeoutMs?: number;
}

export function spawnProcess(
  cmd: string,
  args: ReadonlyArray<string>,
  options: AsyncProcessOptions = {},
): Promise<AsyncProcessResult> {
  const { promise, resolve } = Promise.withResolvers<AsyncProcessResult>();
  const host = options.host ?? hostOs();
  const resolvesSuffixes = host.executableSuffixes.some((suffix) => suffix !== "");
  const executablePath = resolvesSuffixes ? which(cmd, host.executableSuffixes) : cmd;
  if (executablePath === "") {
    // Never hand a pathless name to a host that resolves suffixes: CreateProcess
    // searches the parent's current directory before the system one, so an
    // untrusted checkout could answer for a missing tool.
    resolve({
      exitCode: null,
      stdout: "",
      stderr: "",
      error: new Error(`command not found on PATH: ${cmd}`),
    });
    return promise;
  }
  let child: ChildProcess;
  try {
    // Inside the try: a host whose invocation encoding rejects a value it
    // cannot represent reports it like any other spawn failure.
    const invocation = host.invoke(executablePath, args);
    child = spawn(invocation.command, [...invocation.args], {
      stdio: options.stdio ?? ["ignore", "pipe", "ignore"],
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      // A bounded child leads its own process group on POSIX, so a timeout
      // can end the processes that it started too (see killProcessTree).
      ...(options.timeoutMs !== undefined && !WINDOWS_PROCESS ? { detached: true } : {}),
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    });
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    resolve({ exitCode: null, stdout: "", stderr: "", error });
    return promise;
  }
  let stdout = "";
  let stderr = "";
  let error: Error | undefined;

  if (child.stdout !== null) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stdout.on("error", (cause) => {
      error ??= cause;
    });
  }
  if (child.stderr !== null) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stderr.on("error", (cause) => {
      error ??= cause;
    });
  }
  child.once("error", (cause) => {
    error ??= cause;
  });
  const timer =
    options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          // A version proxy, such as rustup, runs the real tool as its own
          // child, so end the whole process tree, not only the direct child.
          // A process that holds the pipes could still keep them open, and
          // "close" waits for the pipes. Close our ends and unref the child,
          // so neither this promise nor the event loop waits for it.
          killProcessTree(child);
          child.stdout?.destroy();
          child.stderr?.destroy();
          child.unref();
          resolve({ exitCode: null, stdout, stderr, timedOut: true });
        }, options.timeoutMs);
  child.once("close", (exitCode) => {
    clearTimeout(timer);
    resolve({ exitCode, stdout, stderr, ...(error !== undefined ? { error } : {}) });
  });
  return promise;
}

/**
 * The kill strategy follows the real platform, not the injected `host`: the
 * host only shapes command resolution and argv.
 */
const WINDOWS_PROCESS = process.platform === "win32";

/**
 * Ends `child` and every process it started. On POSIX the child leads its own
 * process group (`detached`), so a signal to the negative pid reaches the
 * group. On Windows, `taskkill /T` ends the process tree; its absolute path
 * keeps CreateProcess from finding a `taskkill` in the current directory.
 */
function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (WINDOWS_PROCESS) {
    const taskkill = `${process.env["SystemRoot"] ?? "C:\\Windows"}\\System32\\taskkill.exe`;
    spawnSync(taskkill, ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group is already gone; kill the child in case it left the group.
    child.kill("SIGKILL");
  }
}

export async function capture(cmd: string, args: ReadonlyArray<string>): Promise<string> {
  const res = await spawnProcess(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
  if (res.error !== undefined || res.exitCode !== 0) return "";
  return res.stdout.replace(/[\r\n]+$/, "");
}

/** The result of `captureWithin`: the output, a failure, or no answer in time. */
export type CaptureOutcome =
  | { readonly kind: "output"; readonly stdout: string }
  | { readonly kind: "failed" }
  | { readonly kind: "timed-out" };

/**
 * `capture` with a time limit. A command that does not close within
 * `timeoutMs` is killed and reported as `timed-out`, not as an empty output,
 * so the caller can tell "no answer" from "no version".
 */
export async function captureWithin(
  cmd: string,
  args: ReadonlyArray<string>,
  timeoutMs: number,
): Promise<CaptureOutcome> {
  const res = await spawnProcess(cmd, args, { stdio: ["ignore", "pipe", "ignore"], timeoutMs });
  if (res.timedOut === true) return { kind: "timed-out" };
  if (res.error !== undefined || res.exitCode !== 0) return { kind: "failed" };
  return { kind: "output", stdout: res.stdout.replace(/[\r\n]+$/, "") };
}

/**
 * Splits a Windows PATH on semicolons outside double quotes, then removes one
 * enclosing quote pair from each entry. cmd.exe and libuv read PATH this way.
 */
function windowsPathEntries(path: string): Array<string> {
  const entries: Array<string> = [];
  let entry = "";
  let quoted = false;
  for (const char of path) {
    if (char === '"') quoted = !quoted;
    if (char === ";" && !quoted) {
      entries.push(entry);
      entry = "";
    } else {
      entry += char;
    }
  }
  entries.push(entry);
  return entries.map((value) => (/^".*"$/.test(value) ? value.slice(1, -1) : value));
}

/** `command -v` — resolve an executable name on PATH. */
export function which(
  name: string,
  suffixes: ReadonlyArray<string> = hostOs().executableSuffixes,
): string {
  const runnableCandidate = (base: string): string => {
    for (const suffix of suffixes) {
      const candidate = `${base}${suffix}`;
      if (isExecutable(candidate, suffixes)) return candidate;
    }
    return "";
  };

  if (isAbsolute(name) || name.includes("/")) return runnableCandidate(name);
  const path = process.env["PATH"] ?? "";
  // Windows rules (a non-empty suffix) read quoted PATH entries; POSIX keeps the literal split.
  const windowsRules = suffixes.some((suffix) => suffix !== "");
  for (const dir of windowsRules ? windowsPathEntries(path) : path.split(delimiter)) {
    if (dir === "") continue;
    const candidate = runnableCandidate(join(dir, name));
    if (candidate !== "") return candidate;
  }
  return "";
}

export function commandExists(name: string): boolean {
  return which(name) !== "";
}

function isExecutable(
  path: string,
  suffixes: ReadonlyArray<string> = hostOs().executableSuffixes,
): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (suffixes.some((suffix) => suffix !== "")) {
      const lowerPath = path.toLowerCase();
      return suffixes.some((suffix) =>
        suffix === "" ? extname(path) === "" : lowerPath.endsWith(suffix.toLowerCase()),
      );
    }
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Change-detection primitives (Output Policy in DESIGN.md): operations report
// changed:boolean so unchanged repeat runs log at verbose instead of [ok].

/** Write only when the content differs; returns whether a write happened. */
export function writeTextIfChanged(path: string, content: string): boolean {
  if (existsSync(path) && readFileSync(path, "utf8") === content) return false;
  writeFileSync(path, content);
  return true;
}

export function writeBytesIfChanged(path: string, content: Uint8Array): boolean {
  const bytes = Buffer.from(content);
  if (existsSync(path) && readFileSync(path).equals(bytes)) return false;
  writeFileSync(path, bytes);
  return true;
}
