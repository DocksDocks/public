/**
 * Read-only report of disk and memory use that `docks-kit tidy --apply` does
 * not remove. The report runs only listing and measuring commands. Each
 * section runs on its own; a failure becomes one `unavailable: <message>` line.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isSameOrInside } from "./scratch";
import { runBounded } from "./syncConcurrency";
import {
  agentRoots,
  commandName,
  DAY_MS,
  defaultBranchRef,
  errorMessage,
  firstLine,
  HOUR_MS,
  listWorktreeCandidates,
  isProtectedProcess,
  lstatOrUndefined,
  localDocker,
  mainRepository,
  normalizePath,
  notLocalMessage,
  orphanParents,
  PROCESS_LIST_UNAVAILABLE,
  repositoryWorktrees,
  shorten,
  shortRef,
  sortedEntries,
  worktreeRepository,
  type DockerAccess,
  type ProcessRow,
  type TidyHost,
  type TidyInputs,
} from "./tidy";

export interface TidyReportSection {
  readonly title: string;
  readonly lines: ReadonlyArray<string>;
}

const REPORT_PROCESS_AGE_MS = 12 * HOUR_MS;
const RECENT_MS = 30 * DAY_MS;
const TEMP_ENTRY_COUNT = 5;
const TEMP_ROOTS = ["/tmp", "/var/tmp"] as const;

/**
 * Development tools, servers, and tunnels. The report tests it against the
 * file name of each argument, so a directory such as `/opt/google/chrome/`
 * does not match. The lookahead rejects a longer name, so `ssh-agent` and
 * `chrome_crashpad_handler` do not match.
 */
const DEV_PROCESS =
  /\b(node|bun|deno|npm|pnpm|yarn|npx|bunx|python[0-9.]*|php|ruby|java|cargo|vite|next|webpack|esbuild|tsc|vitest|jest|playwright|chrome|chromium|mysqld|postgres|redis-server|mongod|ssh|kubectl|cloudflared|ngrok|tail|watch)(?![-\w])/;

const DOCKER_HINTS: Readonly<Record<string, string>> = {
  "Build Cache": "docker builder prune --filter until=168h",
  Images: "docker image prune (dangling images only)",
  Containers: "docks-kit tidy --apply removes agent leftovers",
  "Local Volumes": "review named volumes; never prune them blindly",
};

/** Package and tool caches, home-relative unless absolute; a hint names the prune command. */
const CACHES: ReadonlyArray<{ readonly path: string; readonly hint?: string }> = [
  { path: ".npm", hint: "npm cache verify" },
  { path: ".bun/install/cache", hint: "bun pm cache rm" },
  { path: ".cache/pnpm", hint: "pnpm store prune" },
  { path: ".local/share/pnpm/store", hint: "pnpm store prune" },
  { path: "/tmp/.pnpm-store", hint: "pnpm store prune" },
  { path: ".cache/uv", hint: "uv cache prune" },
  { path: ".cache/pip", hint: "pip cache purge" },
  { path: ".cache/composer", hint: "composer clear-cache" },
  { path: ".cache/go-build", hint: "go clean -cache" },
  { path: ".cache/ms-playwright" },
  { path: ".cache/puppeteer" },
  { path: ".cache/huggingface" },
];

const HISTORIES: ReadonlyArray<{ readonly path: string; readonly hint?: string }> = [
  { path: ".omp/agent/sessions", hint: "omp gc --apply" },
  { path: ".claude/projects" },
  { path: ".codex/sessions" },
];

function formatKb(kb: number): string {
  return kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} GB` : `${(kb / 1024).toFixed(1)} MB`;
}

function formatAge(ms: number): string {
  return ms < 2 * DAY_MS ? `${Math.floor(ms / HOUR_MS)} h` : `${Math.floor(ms / DAY_MS)} d`;
}

/** Disk use of one path in KiB, from `du -sk`. A partial read (exit 1) still counts. */
async function sizeKb(path: string, host: TidyHost): Promise<number> {
  const result = await host.run("du", ["-sk", path]);
  const kb = Number.parseInt(result.stdout.trim().split(/\s+/)[0] ?? "", 10);
  if (Number.isFinite(kb)) return kb;
  throw new Error(result.missing ? "du is not on PATH" : `du ${path}: ${firstLine(result)}`);
}

/** `<size>  <path>` lines for the paths that exist, plus their hints in order. */
async function sizeLines(
  entries: ReadonlyArray<{ readonly path: string; readonly hint?: string }>,
  home: string,
  host: TidyHost,
): Promise<Array<string>> {
  const present = entries
    .map((entry) => ({
      ...entry,
      path: entry.path.startsWith("/") ? entry.path : join(home, entry.path),
    }))
    .filter((entry) => lstatOrUndefined(entry.path)?.isDirectory() === true);
  const sizes = await runBounded(
    present.map((entry) => () => sizeKb(entry.path, host)),
    3,
  );
  const hints = [
    ...new Set(present.flatMap((entry) => (entry.hint === undefined ? [] : [entry.hint]))),
  ];
  return [
    ...present.map((entry, index) => `${formatKb(sizes[index]!)}  ${entry.path}`),
    ...hints.map((hint) => `hint: ${hint}`),
  ];
}

// --------------------------------------------------------------- sections ----

async function memorySection(
  rows: ReadonlyArray<ProcessRow> | undefined,
  host: TidyHost,
): Promise<Array<string>> {
  const lines: Array<string> = [];
  if (process.platform === "linux") {
    const meminfo = readFileSync("/proc/meminfo", "utf8");
    const field = (name: string): number | undefined => {
      const match = new RegExp(`^${name}:\\s+(\\d+) kB`, "m").exec(meminfo);
      return match === null ? undefined : Number(match[1]);
    };
    const total = field("SwapTotal");
    const free = field("SwapFree");
    if (total !== undefined && free !== undefined) {
      lines.push(`swap: ${formatKb(total - free)} used of ${formatKb(total)}`);
    }
    const mounts = ["/tmp", "/dev/shm"].filter((path) => lstatOrUndefined(path) !== undefined);
    const df = await host.run("df", ["-kP", ...mounts]);
    if (df.code !== 0) lines.push(`unavailable: df: ${firstLine(df)}`);
    else {
      const dfRows = df.stdout
        .split("\n")
        .slice(1)
        .filter((line) => line.trim() !== "");
      dfRows.forEach((line, index) => {
        const fields = line.trim().split(/\s+/);
        const size = Number(fields[1]);
        const used = Number(fields[2]);
        const mount = mounts[index];
        if (mount !== undefined && Number.isFinite(size) && Number.isFinite(used)) {
          lines.push(`${mount}: ${formatKb(used)} used of ${formatKb(size)} (${fields[0]})`);
        }
      });
    }
  }
  if (rows === undefined) {
    lines.push(`unavailable: ${PROCESS_LIST_UNAVAILABLE}`);
    return lines;
  }
  const omp = rows.filter((row) => commandName(row.comm) === "omp");
  if (omp.length > 0) {
    const rss = omp.reduce((sum, row) => sum + row.rssKb, 0);
    lines.push(`omp processes: ${omp.length}, ${formatKb(rss)} resident`);
    lines.push("hint: close idle omp sessions");
  }
  return lines;
}

async function temporarySection(host: TidyHost, now: number): Promise<Array<string>> {
  const uid = process.getuid?.();
  const roots = [...new Set(TEMP_ROOTS.map((root) => normalizePath(root)))];
  const entries: Array<{
    readonly path: string;
    readonly ageMs: number;
    readonly directory: boolean;
    readonly kb: number;
  }> = [];
  for (const root of roots) {
    for (const name of sortedEntries(root)) {
      const path = join(root, name);
      const stats = lstatOrUndefined(path);
      if (stats === undefined || (uid !== undefined && stats.uid !== uid)) continue;
      entries.push({
        path,
        ageMs: now - stats.mtimeMs,
        directory: stats.isDirectory(),
        kb: Math.ceil((stats.blocks * 512) / 1024),
      });
    }
  }
  const directories = entries.filter((entry) => entry.directory);
  const sizes = await runBounded(
    directories.map((entry) => () => sizeKb(entry.path, host)),
    3,
  );
  const measured = [
    ...entries.filter((entry) => !entry.directory),
    ...directories.map((entry, index) => ({ ...entry, kb: sizes[index]! })),
  ];
  const largest = measured.sort((a, b) => b.kb - a.kb).slice(0, TEMP_ENTRY_COUNT);
  if (largest.length === 0) return [];
  return [
    ...largest.map(
      (entry) => `${formatKb(entry.kb)}  ${formatAge(entry.ageMs)} old  ${entry.path}`,
    ),
    "hint: docks-kit scratch remove <path> removes an entry that an agent created",
  ];
}

/** Listening TCP ports per PID, from `ss -ltnpH`. */
async function listeningPorts(host: TidyHost): Promise<Map<number, Set<string>>> {
  const ports = new Map<number, Set<string>>();
  const result = await host.run("ss", ["-ltnpH"]);
  if (result.code !== 0) return ports;
  for (const line of result.stdout.split("\n")) {
    const local = line.trim().split(/\s+/)[3];
    const port = local?.slice(local.lastIndexOf(":") + 1);
    if (port === undefined || port === "") continue;
    for (const match of line.matchAll(/pid=(\d+)/g)) {
      const pid = Number(match[1]);
      ports.set(pid, (ports.get(pid) ?? new Set()).add(port));
    }
  }
  return ports;
}

async function processSection(
  rows: ReadonlyArray<ProcessRow> | undefined,
  territory: ReadonlyArray<string>,
  host: TidyHost,
): Promise<Array<string>> {
  if (rows === undefined) return [`unavailable: ${PROCESS_LIST_UNAVAILABLE}`];
  const parents = orphanParents(rows);
  const selected = rows.filter((row) => {
    // The report never suggests `kill` for the agent harness, its launcher, or the kit.
    if (row.ageMs < REPORT_PROCESS_AGE_MS || isProtectedProcess(row)) return false;
    const names = row.args
      .split(/\s+/)
      .map((word) => word.slice(word.lastIndexOf("/") + 1))
      .join(" ");
    const devOrphan = parents.has(row.ppid) && DEV_PROCESS.test(names);
    if (devOrphan) return true;
    if (row.cwd === undefined) return false;
    const cwd = normalizePath(row.cwd);
    return territory.some((root) => isSameOrInside(root, cwd));
  });
  if (selected.length === 0) return [];
  const ports =
    process.platform === "linux" ? await listeningPorts(host) : new Map<number, Set<string>>();
  return [
    ...selected.map((row) => {
      const listening = [...(ports.get(row.pid) ?? [])];
      const suffix = listening.length === 0 ? "" : ` ports ${listening.join(",")}`;
      return `${row.pid} ${Math.floor(row.ageMs / HOUR_MS)} h ${formatKb(row.rssKb)} ${row.cwd ?? "?"} ${shorten(row.args, 100)}${suffix}`;
    }),
    "hint: kill <pid> after you confirm that nothing uses it",
  ];
}

async function dockerSection(host: TidyHost, docker: DockerAccess): Promise<Array<string>> {
  if (docker.kind === "missing") throw new Error("docker is not on PATH");
  const runDocker = localDocker(host, docker);
  if (runDocker === undefined) throw new Error(notLocalMessage(docker.endpoint));
  const result = await runDocker([
    "system",
    "df",
    "--format",
    "{{.Type}}\\t{{.Size}}\\t{{.Reclaimable}}",
  ]);
  if (result.code !== 0) throw new Error(`docker system df: ${firstLine(result)}`);
  return result.stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      const [type = "", size = "", reclaimable = ""] = line.trim().split("\t");
      const hint = DOCKER_HINTS[type];
      return [
        `${type}: ${size}, reclaimable ${reclaimable}`,
        ...(hint === undefined ? [] : [`hint: ${hint}`]),
      ];
    });
}

async function trashSection(home: string, host: TidyHost): Promise<Array<string>> {
  if (process.platform === "darwin") return sizeLines([{ path: ".Trash" }], home, host);
  const files = join(home, ".local", "share", "Trash", "files");
  const lines = await sizeLines([{ path: files }], home, host);
  if (lines.length === 0) return [];
  const info = join(home, ".local", "share", "Trash", "info");
  let oldest: string | undefined;
  for (const name of sortedEntries(info)) {
    if (!name.endsWith(".trashinfo")) continue;
    try {
      const date = /^DeletionDate=(.+)$/m.exec(readFileSync(join(info, name), "utf8"))?.[1]?.trim();
      if (date !== undefined && (oldest === undefined || date < oldest)) oldest = date;
    } catch {
      // An unreadable entry does not change the oldest date.
    }
  }
  if (oldest !== undefined) lines.push(`oldest item deleted ${oldest}`);
  const setting = await host.run("gsettings", [
    "get",
    "org.gnome.desktop.privacy",
    "remove-old-trash-files",
  ]);
  if (setting.code === 0 && setting.stdout.trim() === "false") {
    lines.push("hint: gsettings set org.gnome.desktop.privacy remove-old-trash-files true");
  }
  return lines;
}

async function gitSection(
  inputs: TidyInputs,
  worktreeRoot: string | undefined,
  host: TidyHost,
): Promise<Array<string>> {
  const repos = new Set<string>();
  if (inputs.repo !== undefined) {
    const repo = await mainRepository(inputs.repo, host);
    if (repo !== undefined) repos.add(repo);
  } else {
    const listing = await listWorktreeCandidates(inputs, host);
    for (const candidate of listing.candidates) {
      if (candidate.admin === undefined) continue;
      const repo = await worktreeRepository(candidate.path, candidate.admin, host);
      if (repo !== undefined) repos.add(repo);
    }
  }
  const lines: Array<string> = [];
  for (const repo of [...repos].sort()) {
    const worktrees = (await repositoryWorktrees(repo, host)) ?? [];
    const ref = await defaultBranchRef(repo, host);
    if (ref !== undefined) {
      const defaultBranch = ref.replace(/^refs\/remotes\/[^/]+\//, "");
      const checkedOut = new Set(
        worktrees.flatMap((entry) => (entry.branch === undefined ? [] : [shortRef(entry.branch)])),
      );
      const merged = await host.git([
        "-C",
        repo,
        "branch",
        "--merged",
        ref,
        "--format=%(refname:short)",
      ]);
      const branches = merged.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((branch) => branch !== "" && branch !== defaultBranch && !checkedOut.has(branch));
      if (merged.code === 0 && branches.length > 0) {
        lines.push(
          `${repo}: local branches merged into ${shortRef(ref)} (${branches.length}): ${branches.join(", ")}`,
        );
        lines.push("hint: git branch -d <branch>");
      }
    }
    const stash = await host.git(["-C", repo, "stash", "list"]);
    const stashes = stash.stdout.split("\n").filter((line) => line.trim() !== "").length;
    if (stash.code === 0 && stashes > 0) lines.push(`${repo}: stash entries: ${stashes}`);
    const outside = worktrees
      .slice(1)
      .filter(
        (entry) => worktreeRoot === undefined || !isSameOrInside(worktreeRoot, entry.path),
      ).length;
    if (outside > 0) {
      lines.push(
        `${repo}: linked worktrees outside ${worktreeRoot ?? "the agent worktree root"}: ${outside}`,
      );
      lines.push(`hint: docks-kit tidy --repo ${repo}`);
    }
  }
  return lines;
}

/** Names in `directory` whose entry changed in the last 30 days. */
function recentNames(
  directory: string,
  now: number,
  keep: (name: string) => boolean,
): Array<string> {
  return sortedEntries(directory).filter((name) => {
    if (!keep(name)) return false;
    const stats = lstatOrUndefined(join(directory, name));
    return stats !== undefined && now - stats.mtimeMs <= RECENT_MS;
  });
}

async function scheduledSection(home: string, host: TidyHost, now: number): Promise<Array<string>> {
  const lines: Array<string> = [];
  const crontab = await host.run("crontab", ["-l"]);
  if (crontab.code === 0) {
    const entries = crontab.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#")).length;
    if (entries > 0) lines.push(`crontab: ${entries} entries`);
  }
  const units =
    process.platform === "darwin"
      ? recentNames(join(home, "Library", "LaunchAgents"), now, (name) => name.endsWith(".plist"))
      : recentNames(join(home, ".config", "systemd", "user"), now, (name) =>
          /\.(service|timer|path)$/.test(name),
        );
  if (units.length > 0) {
    const label = process.platform === "darwin" ? "launch agents" : "systemd user units";
    lines.push(`${label} changed in the last 30 days: ${units.join(", ")}`);
  }
  return lines;
}

/**
 * Bun keeps the packages that `bun add -g` installed in the dependencies of
 * its global `package.json`; its `node_modules` also holds their dependencies.
 */
function bunGlobalPackages(home: string): Array<string> {
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(join(home, ".bun", "install", "global", "package.json"), "utf8"),
    );
    const dependencies =
      typeof manifest === "object" && manifest !== null && "dependencies" in manifest
        ? manifest.dependencies
        : undefined;
    return typeof dependencies === "object" && dependencies !== null
      ? Object.keys(dependencies).sort()
      : [];
  } catch {
    return [];
  }
}

async function globalSection(home: string, host: TidyHost, now: number): Promise<Array<string>> {
  const keep = (name: string): boolean => name !== ".bin" && name !== ".cache";
  const lines: Array<string> = [];
  const bunModules = join(home, ".bun", "install", "global", "node_modules");
  const bun = bunGlobalPackages(home).filter((name) => {
    const stats = lstatOrUndefined(join(bunModules, name));
    return stats !== undefined && now - stats.mtimeMs <= RECENT_MS;
  });
  if (bun.length > 0)
    lines.push(`bun global installs changed in the last 30 days: ${bun.join(", ")}`);
  const npmRoot = await host.run("npm", ["root", "-g"]);
  const root = npmRoot.code === 0 ? npmRoot.stdout.trim() : "";
  if (root !== "") {
    const npm = recentNames(root, now, keep);
    if (npm.length > 0)
      lines.push(`npm global installs changed in the last 30 days: ${npm.join(", ")}`);
  }
  return lines;
}

async function section(
  title: string,
  build: () => Promise<ReadonlyArray<string>>,
): Promise<TidyReportSection | undefined> {
  try {
    const lines = await build();
    return lines.length === 0 ? undefined : { title, lines };
  } catch (cause) {
    return { title, lines: [`unavailable: ${errorMessage(cause)}`] };
  }
}

/**
 * Build the report sections in their fixed order; a section with no lines is
 * left out. `docker` is the access that the plan of the same run resolved.
 */
export async function buildTidyReport(
  inputs: TidyInputs,
  host: TidyHost,
  docker: DockerAccess,
): Promise<ReadonlyArray<TidyReportSection>> {
  if (process.platform === "win32") {
    return [{ title: "Report", lines: ["docks-kit tidy --report supports Linux and macOS"] }];
  }
  const now = host.now();
  const home = normalizePath(inputs.home);
  const roots = agentRoots(inputs);
  const rows = await host.processes().catch(() => undefined);
  // A process cwd keeps the spelling that it has when the path is gone, so
  // each temporary root counts in both its typed and its real spelling.
  const territory = [
    roots.worktreeRoot,
    roots.scratchRoot,
    ...TEMP_ROOTS.flatMap((root) => [root, normalizePath(root)]),
  ].filter((path): path is string => path !== undefined);
  const sections = await Promise.all([
    section("Memory", () => memorySection(rows, host)),
    section("Temporary directories", () => temporarySection(host, now)),
    section("Processes", () => processSection(rows, territory, host)),
    section("Docker", () => dockerSection(host, docker)),
    section("Package and tool caches", () => sizeLines(CACHES, home, host)),
    section("Trash", () => trashSection(home, host)),
    section("Git", () => gitSection(inputs, roots.worktreeRoot, host)),
    section("Agent histories", () => sizeLines(HISTORIES, home, host)),
    section("Scheduled jobs and services", () => scheduledSection(home, host, now)),
    section("Global installs", () => globalSection(home, host, now)),
  ]);
  return sections.filter((entry): entry is TidyReportSection => entry !== undefined);
}
