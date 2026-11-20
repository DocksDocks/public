/**
 * The agent-docs suites' harness, ported from DocksDocks/docks
 * `scripts/tests/unit/agent-docs-scripts.test.mjs`.
 *
 * Each case builds its fixture folders under the system temporary directory,
 * runs a helper there through `entry.ts`, and compares the whole stdout, the
 * whole stderr, and the exit status. The folders go away when the case ends.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { expect, onTestFinished } from "vitest";

import {
  type Helper,
  type HelperResult,
  runHelper,
  runtimeStderr as entryRuntimeStderr,
  usageLine,
} from "./entry";

/**
 * The fixtures need symlinks, a FIFO, and POSIX modes, and the helpers report
 * POSIX paths, so the suites run on Linux and macOS only.
 */
export const AGENT_DOCS_HOST_SUPPORTED = process.platform !== "win32";

/** A mode-0 file or folder blocks nobody when the tests run as root. */
export const IS_ROOT = process.getuid?.() === 0;

/**
 * Whether the file system of the fixture folders keeps names that differ only in letter case apart. The default
 * macOS file system does not, so a fixture that holds such a pair cannot exist there.
 */
export const CASE_SENSITIVE_NAMES = ((): boolean => {
  const probe = mkdtempSync(join(tmpdir(), "agent-docs-case-"));
  try {
    writeFileSync(join(probe, "a"), "");
    return !existsSync(join(probe, "A"));
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();
export const CASE_INSENSITIVE_SKIP =
  "the file system does not keep names that differ only in letter case apart";

/**
 * Variables that would point git at another repository: a git hook exports
 * `GIT_DIR` and `GIT_INDEX_FILE`.
 */
const GIT_REPOSITORY_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
];

export type FixtureOptions = {
  readonly git?: boolean;
  /** A path and its text; `undefined` skips the entry. */
  readonly files?: Readonly<Record<string, string | undefined>>;
  /** A path and its symlink target. */
  readonly links?: Readonly<Record<string, string>>;
  /** Empty folders. */
  readonly dirs?: ReadonlyArray<string>;
  /** A path and the mode it gets last. */
  readonly modes?: Readonly<Record<string, number>>;
};

export type Fixture = {
  readonly dir: string;
  readonly env: NodeJS.ProcessEnv;
};

/** Build one fixture folder; it goes away, locked entries included, when the case ends. */
export function fixture({
  git = true,
  files = {},
  links = {},
  dirs = [],
  modes = {},
}: FixtureOptions = {}): Fixture {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "agent-docs-")));
  const locked: Array<string> = [];
  onTestFinished(() => {
    for (const path of locked) chmodSync(path, 0o700);
    rmSync(dir, { recursive: true, force: true });
  });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    // The global ignore file ($XDG_CONFIG_HOME/git/ignore) applies also without a global config file.
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.excludesFile",
    GIT_CONFIG_VALUE_0: "/dev/null",
    // Outside git, no repository above the fixture may answer `git rev-parse`.
    GIT_CEILING_DIRECTORIES: dirname(dir),
    // The cases compare git's messages on stderr whole, so git must not translate them.
    LC_ALL: "C",
  };
  for (const name of GIT_REPOSITORY_ENV) delete env[name];
  if (git) {
    const init = spawnSync("git", ["init", "-q"], { cwd: dir, env, encoding: "utf8" });
    expect(init.status, `git init: ${init.stderr}`).toBe(0);
  }
  const at = (path: string): string => {
    const abs = join(dir, path);
    mkdirSync(dirname(abs), { recursive: true });
    return abs;
  };
  for (const folder of dirs) mkdirSync(join(dir, folder), { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    if (text !== undefined) writeFileSync(at(path), text);
  }
  for (const [path, target] of Object.entries(links)) symlinkSync(target, at(path));
  for (const [path, mode] of Object.entries(modes)) {
    chmodSync(join(dir, path), mode);
    locked.push(join(dir, path));
  }
  return { dir, env };
}

/** Run `<helper> <args>` in the fixture folder, or in its subfolder `sub`. */
export function run(
  helper: Helper,
  args: ReadonlyArray<string>,
  fx: Fixture,
  sub = "",
): HelperResult {
  return runHelper(helper, args, { cwd: join(fx.dir, sub), env: fx.env });
}

/** The stderr that the entry's runtime writes in the fixture folder before any helper code runs (see entry.ts). */
export function runtimeStderr(fx: Fixture, sub = ""): string {
  return entryRuntimeStderr({ cwd: join(fx.dir, sub), env: fx.env });
}

/** The stdout of a run that prints `lines`: each line ends with a newline. */
export function output(lines: ReadonlyArray<string>): string {
  return lines.map((line) => `${line}\n`).join("");
}

/** The whole stdout, the whole stderr, and the status of one run. */
export function expectRun(
  result: HelperResult,
  status: number,
  lines: ReadonlyArray<string>,
  stderr = "",
): void {
  expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({
    status,
    stdout: output(lines),
    stderr,
  });
}

/** A usage error: exit 1, no stdout, and the usage line of the entry on stderr. */
export function expectUsage(result: HelperResult, helper: Helper): void {
  expectRun(result, 1, [], `${usageLine(helper)}\n`);
}

/** Every entry below a fixture folder except .git: a file gives its text, a symlink its target, a folder `folder`. */
export function treeEntries(dir: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const walk = (folder: string): void => {
    for (const entry of readdirSync(join(dir, folder), { withFileTypes: true })) {
      const relative = posix.join(folder, entry.name);
      if (relative === ".git") continue;
      const abs = join(dir, relative);
      if (entry.isSymbolicLink()) entries[relative] = `link ${readlinkSync(abs)}`;
      else if (entry.isDirectory()) {
        entries[relative] = "folder";
        walk(relative);
      } else entries[relative] = readFileSync(abs, "utf8");
    }
  };
  walk("");
  return entries;
}

// The fixture texts and the expected lines that several suites share.

export const STALE = "Pointers here name concepts; check each one before you trust it.\n";
export const ROOT_AGENTS = `# Repo\n\nBuild with \`make build\`, test with \`make test\`, and lint with \`make lint\`.\n\n${STALE}`;
export const routed = (...nodes: ReadonlyArray<string>): string =>
  `${ROOT_AGENTS}\n## Context tree\n\n| Node | Scope |\n|---|---|\n${nodes.map((n) => `| \`${n}\` | folder |\n`).join("")}`;
export const skill = (name: string, description: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
export const VERIFY_SKILL = `${skill("verify", '"Use when checking this repository end to end."')}
| Id | Flow | Command | Expected result |
|---|---|---|---|
| V1 | Build | \`make build\` | exit 0 |
`;
export const MARKED_SKILL = `${skill("verify", '"Use when checking this repository end to end."')}
| Id | Flow | Command | Expected result |
|---|---|---|---|
| V1 | Build | \`make build\` | not observed: expect exit 0 |
| V2 | Test | \`make test\` | not observed: expect exit 0; got make: *** [test] Error 1 |
`;
export const MARKS = [
  "10:| V1 | Build | `make build` | not observed: expect exit 0 |",
  "11:| V2 | Test | `make test` | not observed: expect exit 0; got make: *** [test] Error 1 |",
];
export const TEST_SKILL = skill("x", '"Use when testing."');

/** A repository that passes every agent-first check; each check case adds or removes entries. */
export const BASE_FILES: Readonly<Record<string, string | undefined>> = {
  "AGENTS.md": ROOT_AGENTS,
  ".agents/skills/verify/SKILL.md": VERIFY_SKILL,
  ".github/pull_request_template.md": "## Checklist\n",
};
export const BASE: FixtureOptions = { files: BASE_FILES };

/** One non-git folder for both skills: dist/ is pruned only by claude-md-migration, vendor/ and node_modules/ by both. */
export const NON_GIT: FixtureOptions = {
  git: false,
  files: {
    "AGENTS.md": ROOT_AGENTS,
    "CLAUDE.md": "rules\n",
    "CLAUDE.local.md": "mine\n",
    "dist/CLAUDE.md": "built\n",
    "sub/AGENTS.md": STALE,
    "vendor/CLAUDE.md": "vendored\n",
    "vendor/CLAUDE.local.md": "vendored\n",
    "node_modules/pkg/AGENTS.md": STALE,
  },
};

export const PR_ERROR = "ERROR pull-request template check failed (see the message above)";
export const C1 = (kind: string): string =>
  `FINDING C1 root AGENTS.md names no ${kind} command (add it, or accept: the repo has none or one gate covers it)`;
export const C9_NO_SKILL =
  "FINDING C9 no .agents/skills/verify/SKILL.md (add it in Step 2b, or accept: the repo has no runnable surface)";
export const C10_NONE =
  "FINDING C10 no usable pull-request template (add it in Step 2c, or accept: the repository wants none)";
export const C10_ERROR = "ERROR C10 pull-request template check failed (see the message above)";
const MIGRATE = "migrate it with claude-md-migration";
export const C3_NEXT_TO = (file: string): string =>
  `FAIL C3 CLAUDE.md next to an AGENTS.md (omp ignores it; ${MIGRATE}): ${file}`;
export const C3_CLAUDE_FOLDER = (file: string): string =>
  `FAIL C3 .claude/CLAUDE.md (omp loads it instead of the AGENTS.md of that folder when a session starts there; ${MIGRATE}): ${file}`;
export const C3_ALONE = (file: string): string =>
  `FINDING C3 CLAUDE.md without an AGENTS.md next to it (it loads, but AGENTS.md is the convention; ${MIGRATE}): ${file}`;
export const C3_PERSONAL = (file: string): string =>
  `FINDING C3 CLAUDE.local.md that omp does not load (personal file; the user decides: list it in contextFiles.extra, move it to ~/.omp/agent/AGENTS.md, or keep it): ${file}`;
export const C4 = (entry: string): string =>
  `FINDING C4 legacy .claude entry (agent-first-setup cleans it up): ${entry}`;
export const C4_EXTERNAL = (entry: string): string =>
  `FINDING C4 legacy .claude entry outside the repository (report it; never move or remove it): ${entry}`;
export const C4_OTHER = (entry: string): string =>
  `FINDING C4 legacy .claude entry (report only; the user decides): ${entry}`;
export const C3_LINK = (file: string): string =>
  `FAIL C3 CLAUDE.md link to AGENTS.md (remove the link; there is nothing to migrate): ${file}`;

/** The Step 2 entries in block order; `audit(...present)` gives the four presence lines. */
export const AUDIT_PATHS: ReadonlyArray<string> = [
  "AGENTS.md",
  "CLAUDE.md (root)",
  ".claude/CLAUDE.md",
  "CLAUDE.local.md",
];
export const audit = (...present: ReadonlyArray<string>): Array<string> =>
  AUDIT_PATHS.map((p) => `${present.includes(p) ? "EXISTS" : "MISSING"} ${p}`);
/** The last audit line of a repository that is no omp plugin source. */
export const NO_PLUGIN = "plugin author: no";

/** The ERROR line of a check whose file listing failed. */
export const listingFailed = (label: string): string =>
  `ERROR ${label} file listing failed (see the message above)`;
