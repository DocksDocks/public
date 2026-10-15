import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Repository-root tripwire for the unit suite.
 *
 * Vitest runs with the repository root as the working directory, so any test
 * that builds a path from an undefined variable, or forgets to join its own
 * temporary directory, writes into the checkout instead. Such a file is easy
 * to miss: the run still passes and only a later `git status` shows it.
 *
 * The guard snapshots `git status --porcelain -z --untracked-files=all` before
 * and after the run, and fails the run when an entry appeared. A top-level
 * name list missed a nested write such as `SoT/.claude/settings.json`, an edit
 * to a tracked file, and an overwritten golden. The porcelain form reports all
 * three, and it skips `cli/dist-test/` because git already ignores that
 * directory. Entries are listed per file, so a new file inside a directory
 * that was already untracked still shows up as its own entry.
 *
 * A path that was already dirty at setup keeps the same porcelain entry when a
 * test overwrites it, so the guard also hashes every such path at setup and
 * compares the content at teardown. That catches an overwrite of a file that
 * was already modified before the run.
 *
 * Without git, or outside a git work tree, the guard compares the top-level
 * names instead. When git is present but `git status` fails, the guard fails
 * the run instead of falling back, because the name list misses nested
 * changes.
 *
 * The guard never deletes: parallel agents and editors also write in this
 * checkout, so an added line is a report, not proof of ownership. Remove the
 * reported path by hand after you repair the test that wrote it.
 */
const ROOT = resolve(import.meta.dirname, "..", "..", "..");

type Snapshot = {
  readonly kind: "porcelain" | "names";
  // Human-readable `XY path` entries, or top-level names in the fallback.
  readonly lines: ReadonlyArray<string>;
  // Repository-relative paths named by the porcelain entries.
  readonly paths: ReadonlyArray<string>;
};

type Porcelain = { readonly lines: ReadonlyArray<string>; readonly paths: ReadonlyArray<string> };

// One NUL-terminated entry per untracked file can exceed Node's default 1 MiB
// stdout cap on a large untracked tree; spawnSync then fails with ENOBUFS.
const STATUS_MAX_BUFFER = 256 * 1024 * 1024;

// Vitest reports a teardown throw as "error during close" but still exits 0,
// so every guard failure sets the failing status itself. Otherwise the
// tripwire is decorative.
function fail(message: string): never {
  process.exitCode = 1;
  throw new Error(message);
}

// A checkout without git, and a source tree unpacked from an archive, still
// have to run the suite, so the guard falls back to the top-level name list.
// Only those two cases fall back. Once git reports a work tree, a failed status
// is a guard failure: the name list would miss every nested change.
function insideGitWorkTree(): boolean {
  const probe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (probe.error !== undefined) {
    if ((probe.error as NodeJS.ErrnoException).code === "ENOENT") return false;
    fail(`The root guard could not run git in ${ROOT}: ${probe.error.message}`);
  }
  return probe.status === 0 && probe.stdout.trim() === "true";
}

function porcelainEntries(): Porcelain {
  // -z keeps paths with spaces or unicode unquoted; per-file untracked
  // entries stop git from folding new files into an existing `?? dir/`.
  const result = spawnSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: STATUS_MAX_BUFFER,
  });
  if (result.error !== undefined || result.status !== 0) {
    const exit = result.status === null ? `signal ${result.signal}` : `exit code ${result.status}`;
    const stderr = result.stderr.trim();
    const cause = result.error?.message ?? (stderr === "" ? exit : `${exit}: ${stderr}`);
    fail(
      `The root guard could not read git status in ${ROOT} (${cause}), so it cannot check ` +
        "the checkout for stray test writes. Fix the git error and rerun the suite.",
    );
  }
  const fields = result.stdout.split("\0");
  const lines: string[] = [];
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    if (field === undefined || field.length === 0) continue;
    const status = field.slice(0, 2);
    const path = field.slice(3);
    // A rename or copy entry carries its origin path in the next field.
    if (status.includes("R") || status.includes("C")) {
      index++;
      lines.push(`${status} ${fields[index] ?? ""} -> ${path}`);
    } else {
      lines.push(`${status} ${path}`);
    }
    paths.push(path);
  }
  return { lines, paths };
}

function takeSnapshot(): Snapshot {
  if (!insideGitWorkTree()) {
    return { kind: "names", lines: readdirSync(ROOT).sort(), paths: [] };
  }
  return { kind: "porcelain", ...porcelainEntries() };
}

// A missing path, a directory, or a dangling link all read as "absent".
function fingerprint(path: string): string {
  try {
    return createHash("sha256")
      .update(readFileSync(resolve(ROOT, path)))
      .digest("hex");
  } catch {
    return "absent";
  }
}

let before: Snapshot = { kind: "names", lines: [], paths: [] };
let beforeContent: ReadonlyMap<string, string> = new Map();

export function setup(): void {
  before = takeSnapshot();
  beforeContent = new Map(before.paths.map((path) => [path, fingerprint(path)]));
}

export function teardown(): void {
  const after = takeSnapshot();
  // The two snapshots compare only within one mode, so a git binary that
  // disappeared mid-run produces no report instead of a false one.
  if (after.kind !== before.kind) return;
  const added = after.lines.filter((line) => !before.lines.includes(line));
  const modified = [...beforeContent]
    .filter(([path, hash]) => fingerprint(path) !== hash)
    .map(([path]) => `modified during run: ${path}`);
  const reported = [...added, ...modified];
  if (reported.length === 0) return;
  const subject = after.kind === "porcelain" ? "working tree change(s)" : "root entry(s)";
  fail(
    `The checkout gained ${reported.length} ${subject} during the unit run:\n${reported.join("\n")}\n` +
      "A test probably wrote to a path relative to the working directory. Build the path from the " +
      "test's own temporary directory, assert the target before you write, then remove the entry.",
  );
}
