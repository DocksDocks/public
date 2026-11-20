/**
 * The shipped shell that reads instruction files from the merge base: the
 * base-instructions block of plan-manager phase 6 and the base read of
 * code-review. Both read each file through the base-blob helper, and both must
 * give a symlink the text of its target in the base tree. `entry.ts` selects
 * the snippet text and the helper that it calls.
 */
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";

import { PLAN_CLI_ENTRY, skillSnippet, snippetEnv } from "../../lib/plan/entry";
import { PLAN_CLI_HOST_SUPPORTED } from "../../lib/plan/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

type Env = Readonly<Record<string, string>>;

// A git hook exports these, and they would point every command at the caller's repository.
const INHERITED_GIT_KEYS: ReadonlyArray<string> = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];

const GIT_ENV: Env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !INHERITED_GIT_KEYS.includes(entry[0]),
    ),
  ),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Base instructions test",
  GIT_AUTHOR_EMAIL: "base-instructions@example.invalid",
  GIT_COMMITTER_NAME: "Base instructions test",
  GIT_COMMITTER_EMAIL: "base-instructions@example.invalid",
  LC_ALL: "C",
};

function sh(cwd: string, script: string, env: Env = {}): SpawnSyncReturns<string> {
  return spawnSync("bash", ["-c", script], {
    cwd,
    env: { ...GIT_ENV, ...env },
    encoding: "utf8",
  });
}

function git(cwd: string, ...args: ReadonlyArray<string>): string {
  const result = spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
  expect(result.status, `git ${args.join(" ")}: ${result.stderr}`).toBe(0);
  return result.stdout;
}

function put(repo: string, file: string, text: string): void {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), text);
}

function link(repo: string, file: string, target: string): void {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  symlinkSync(target, join(repo, file));
}

/** A scratch root, its repository, and the variables that the selected snippets need. */
type Repo = {
  readonly root: string;
  readonly repo: string;
  readonly base: string;
  readonly env: Env;
};

// The base commit holds a root AGENTS.md and a CLAUDE.md link to it, as the benchmark fixture does, and links that
// resolve from the link's folder, a two-link chain, and links that are dangling, outside the tree, absolute, or a
// loop. The working tree changes AGENTS.md and src/a.mjs, commits src/lib/b.mjs, and adds an untracked file.
// deep/ holds a chain of 8 links and a chain of 9 links, which both resolve; no changed path is in deep/.
const SHARED = "# Shared rules\n";
const EXPECTED = new Map<string, string | null>([
  ["AGENTS.md", "# Root rules at the base\n"],
  ["CLAUDE.md", "# Root rules at the base\n"],
  ["REVIEW.md", null],
  ["src/AGENTS.md", SHARED],
  ["src/CLAUDE.md", null],
  ["src/REVIEW.md", "# Review rules at the base\n"],
  ["src/lib/AGENTS.md", SHARED],
  ["src/lib/CLAUDE.md", null],
  ["src/lib/REVIEW.md", null],
]);

function newRepo(): { readonly root: string; readonly repo: string; readonly env: Env } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "base-instructions-")));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  return { root, repo, env: snippetEnv(root) };
}

function commitBase(repo: string): string {
  git(repo, "commit", "-q", "-m", "base");
  return git(repo, "rev-parse", "HEAD").trim();
}

function instructionRepo(): Repo {
  const { root, repo, env } = newRepo();
  put(repo, "AGENTS.md", "# Root rules at the base\n");
  link(repo, "CLAUDE.md", "AGENTS.md");
  link(repo, "REVIEW.md", "missing.md");
  put(repo, "docs/rules.md", SHARED);
  link(repo, "src/AGENTS.md", "../docs/rules.md");
  link(repo, "src/CLAUDE.md", "../../outside.md");
  put(repo, "src/REVIEW.md", "# Review rules at the base\n");
  put(repo, "src/a.mjs", "export const a = 1;\n");
  link(repo, "src/lib/AGENTS.md", "../AGENTS.md");
  link(repo, "src/lib/CLAUDE.md", "/etc/hosts");
  link(repo, "src/lib/REVIEW.md", "REVIEW.md");
  put(repo, "deep/rules.md", "# Deep rules\n");
  for (let hop = 1; hop <= 8; hop += 1) {
    link(repo, `deep/a${hop}`, hop === 8 ? "rules.md" : `a${hop + 1}`);
  }
  link(repo, "deep/AGENTS.md", "a2");
  link(repo, "deep/CLAUDE.md", "a1");
  git(repo, "add", "-A");
  const base = commitBase(repo);
  put(repo, "AGENTS.md", "# Root rules of the head\n");
  put(repo, "src/lib/b.mjs", "export const b = 1;\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "head");
  put(repo, "src/a.mjs", "export const a = 2;\n");
  put(repo, "src/lib/new.mjs", "export const c = 1;\n");
  return { root, repo, base, env };
}

// The base commit holds links whose targets test the path rules: a root link to `../outside.md`, a folder link to
// `..` (the root folder, whose first entry is a regular AGENTS.md), an empty target, and targets with `./` and `..`
// segments, also in a nested folder. The working tree adds a file in tools/ and in src/lib/.
const EDGE_REVIEW = "# Src review rules\n";
const EDGE_EXPECTED = new Map<string, string | null>([
  ["AGENTS.md", "# Edge root rules\n"],
  ["CLAUDE.md", null],
  ["REVIEW.md", null],
  ["src/AGENTS.md", null],
  ["src/CLAUDE.md", null],
  ["src/REVIEW.md", EDGE_REVIEW],
  ["src/lib/AGENTS.md", "# Lib rules\n"],
  ["src/lib/CLAUDE.md", EDGE_REVIEW],
  ["src/lib/REVIEW.md", null],
  ["tools/AGENTS.md", null],
  ["tools/CLAUDE.md", null],
  ["tools/REVIEW.md", EDGE_REVIEW],
]);

function edgeRepo(): Repo {
  const { root, repo, env } = newRepo();
  put(repo, "AGENTS.md", "# Edge root rules\n");
  link(repo, "CLAUDE.md", "../outside.md");
  put(repo, "src/REVIEW.md", EDGE_REVIEW);
  put(repo, "src/lib/rules.md", "# Lib rules\n");
  link(repo, "src/lib/AGENTS.md", "./rules.md");
  link(repo, "src/lib/CLAUDE.md", "./../REVIEW.md");
  link(repo, "tools/AGENTS.md", "..");
  link(repo, "tools/REVIEW.md", "./../src/./REVIEW.md");
  git(repo, "add", "-A");
  // A file system cannot hold a link with an empty target, so the index gets it directly.
  const empty = spawnSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: repo,
    env: GIT_ENV,
    input: "",
    encoding: "utf8",
  });
  expect(empty.status, empty.stderr).toBe(0);
  git(
    repo,
    "update-index",
    "--add",
    "--cacheinfo",
    `120000,${empty.stdout.trim()},tools/CLAUDE.md`,
  );
  const base = commitBase(repo);
  put(repo, "tools/x.mjs", "export const x = 1;\n");
  put(repo, "src/lib/x.mjs", "export const x = 1;\n");
  return { root, repo, base, env };
}

// The longest chain that git and Linux follow is 40 links.
const MAX_LINKS = 40;

// Links chain/<first> -> <prefix>1 -> ... -> <prefix><count - 1> -> ../src/REVIEW.md, a chain of `count` links.
function linkChain(repo: string, first: string, prefix: string, count: number): void {
  const names = [first, ...Array.from({ length: count - 1 }, (_, i) => `${prefix}${i + 1}`)];
  for (const [i, name] of names.entries()) {
    link(repo, `chain/${name}`, names[i + 1] ?? "../src/REVIEW.md");
  }
}

// The base commit holds the folder links docs -> src and lnk -> src/lib, the folder links la -> lb and lb -> la (a
// loop), the gitlink mod, and chains of 40 and 41 links. The working tree adds a file in tools/ and in chain/.
const FOLDER_REVIEW = "# Src review rules\n";
const FOLDER_LIB = "# Lib rules\n";
const FOLDER_EXPECTED = new Map<string, string | null>([
  ["AGENTS.md", "# Folder root rules\n"],
  // docs/REVIEW.md: a path through the folder link docs -> src.
  ["CLAUDE.md", FOLDER_REVIEW],
  // mod/REVIEW.md: a path through a gitlink.
  ["REVIEW.md", null],
  // 40 links.
  ["chain/AGENTS.md", FOLDER_REVIEW],
  // 41 links.
  ["chain/CLAUDE.md", null],
  // ../src/REVIEW.md/x: a file used as a folder.
  ["chain/REVIEW.md", null],
  // ../docs/lib/rules.md: a folder link in the target of a link.
  ["tools/AGENTS.md", FOLDER_LIB],
  // ../lnk/../REVIEW.md: `..` after the folder link lnk -> src/lib goes to src, not to the root.
  ["tools/CLAUDE.md", FOLDER_REVIEW],
  // ../la/REVIEW.md: a loop through folder links.
  ["tools/REVIEW.md", null],
]);

function folderRepo(): Repo {
  const { root, repo, env } = newRepo();
  put(repo, "AGENTS.md", "# Folder root rules\n");
  put(repo, "src/REVIEW.md", FOLDER_REVIEW);
  put(repo, "src/lib/rules.md", FOLDER_LIB);
  link(repo, "docs", "src");
  link(repo, "lnk", "src/lib");
  link(repo, "la", "lb");
  link(repo, "lb", "la");
  link(repo, "CLAUDE.md", "docs/REVIEW.md");
  link(repo, "REVIEW.md", "mod/REVIEW.md");
  linkChain(repo, "AGENTS.md", "c", MAX_LINKS);
  linkChain(repo, "CLAUDE.md", "d", MAX_LINKS + 1);
  link(repo, "chain/REVIEW.md", "../src/REVIEW.md/x");
  link(repo, "tools/AGENTS.md", "../docs/lib/rules.md");
  link(repo, "tools/CLAUDE.md", "../lnk/../REVIEW.md");
  link(repo, "tools/REVIEW.md", "../la/REVIEW.md");
  git(repo, "add", "-A");
  // A gitlink names a commit of another repository; an empty folder stands for a submodule that is not checked out.
  mkdirSync(join(repo, "mod"));
  git(repo, "update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},mod`);
  const base = commitBase(repo);
  put(repo, "tools/x.mjs", "export const x = 1;\n");
  put(repo, "chain/n.mjs", "export const n = 1;\n");
  return { root, repo, base, env };
}

// Names that end in a newline. Each pair of names, with and without the newline, holds different rules, so a read
// that drops the newline gives the wrong rules. AGENTS.md links to `rules.md\n`, the folder link docs links to the
// folder `src\n`, and CLAUDE.md links to docs/REVIEW.md. The working tree adds a file in the folder `lib\n`.
const NEWLINE_RULES = "# Rules of the name that ends in a newline\n";
const PLAIN_RULES = "# Rules of the name without the newline\n";
const NEWLINE_EXPECTED = new Map<string, string | null>([
  ["AGENTS.md", NEWLINE_RULES],
  ["CLAUDE.md", NEWLINE_RULES],
  ["REVIEW.md", null],
  ["lib\n/AGENTS.md", NEWLINE_RULES],
  ["lib\n/CLAUDE.md", null],
  ["lib\n/REVIEW.md", null],
]);

function newlineRepo(): Repo {
  const { root, repo, env } = newRepo();
  for (const [plain, newline] of [
    ["rules.md", "rules.md\n"],
    ["src/REVIEW.md", "src\n/REVIEW.md"],
    ["lib/AGENTS.md", "lib\n/AGENTS.md"],
  ] as const) {
    put(repo, plain, PLAIN_RULES);
    put(repo, newline, NEWLINE_RULES);
  }
  link(repo, "AGENTS.md", "rules.md\n");
  link(repo, "docs", "src\n");
  link(repo, "CLAUDE.md", "docs/REVIEW.md");
  git(repo, "add", "-A");
  const base = commitBase(repo);
  put(repo, "lib\n/x.mjs", "export const x = 1;\n");
  return { root, repo, base, env };
}

type Fixture = {
  readonly name: string;
  readonly make: () => Repo;
  readonly expected: ReadonlyMap<string, string | null>;
  readonly extra: ReadonlyArray<readonly [string, string | null]>;
};

// The deep/ chains are outside every changed folder, so only the code-review read checks them.
const FIXTURES: ReadonlyArray<Fixture> = [
  {
    name: "links",
    make: instructionRepo,
    expected: EXPECTED,
    extra: [
      ["deep/AGENTS.md", "# Deep rules\n"],
      ["deep/CLAUDE.md", "# Deep rules\n"],
    ],
  },
  { name: "path edges", make: edgeRepo, expected: EDGE_EXPECTED, extra: [] },
  {
    name: "folder links",
    make: folderRepo,
    expected: FOLDER_EXPECTED,
    extra: [
      ["docs/REVIEW.md", FOLDER_REVIEW],
      ["lnk/../REVIEW.md", FOLDER_REVIEW],
      ["la/AGENTS.md", null],
      ["mod", null],
      ["docs", null],
    ],
  },
  {
    name: "names that end in a newline",
    make: newlineRepo,
    expected: NEWLINE_EXPECTED,
    extra: [
      ["docs/REVIEW.md", NEWLINE_RULES],
      ["src/REVIEW.md", PLAIN_RULES],
      ["rules.md", PLAIN_RULES],
    ],
  },
];

// Removes the loose object of `spec` from the repository, so that git cannot read it.
function dropObject(repo: string, spec: string): void {
  const oid = git(repo, "rev-parse", spec).trim();
  rmSync(join(repo, ".git", "objects", oid.slice(0, 2), oid.slice(2)));
}

/** Where the snippets look for the helper. */
type Helper = { readonly skillDir?: string; readonly env?: Env };

/**
 * A helper that cannot start. In the `plan.mjs` mode the skill folder has no
 * `scripts/base-blob.sh`, so `sh` cannot open the script; in the `docks-kit`
 * mode no PATH folder holds a `docks-kit`, so the shell cannot find the command.
 */
function missingHelper(root: string): Helper {
  if (PLAN_CLI_ENTRY === "plan.mjs") return { skillDir: join(root, "skill-without-scripts") };
  const path = (process.env["PATH"] ?? "")
    .split(delimiter)
    .filter((folder) => folder !== "" && !existsSync(join(folder, "docks-kit")));
  return { env: { PATH: path.join(delimiter) } };
}

// Runs the plan-manager base-instructions block in `repo` for round 1 with the selected helper.
function buildFolder(
  { root, repo, base, env }: Repo,
  extraEnv: Env = {},
  helper: Helper = {},
): { readonly result: SpawnSyncReturns<string>; readonly folder: string } {
  const snippet = skillSnippet("plan-manager");
  const block = snippet.text
    .replace('prev="<previous-reviewed-head or empty>"', 'prev=""')
    .replaceAll("<skill-dir>", helper.skillDir ?? snippet.skillDir);
  expect(block.includes('prev=""'), "the block sets prev").toBe(true);
  const scratch = join(root, "scratch");
  const result = sh(repo, `scratch='${scratch}'\nbase='${base}'\n${block}`, {
    ...env,
    ...helper.env,
    ...extraEnv,
  });
  return { result, folder: join(scratch, "code-review-<n>-round-<k>-base-instructions") };
}

// The code-review base read of `file` at the fixed point `base` with the selected helper.
function baseRead(base: string, file: string, helper: Helper = {}): string {
  const snippet = skillSnippet("code-review");
  const script = snippet.text
    .replace("<fixed-point>", base)
    .replaceAll("<path>", file)
    .replaceAll("<skill-dir>", helper.skillDir ?? snippet.skillDir);
  expect(script, "the snippet names a fixed point, a path, and the skill folder").not.toMatch(
    /<[a-z-]+>/,
  );
  return script;
}

// Each case makes a git command fail: `path` is an instruction file whose read fails. A failed read is not an
// absent file.
type GitFailure = {
  readonly name: string;
  readonly path: string;
  readonly make?: () => Repo;
  readonly drop?: string;
  readonly gitDir?: string;
};

const GIT_FAILURES: ReadonlyArray<GitFailure> = [
  { name: "the target blob of a link is missing", path: "src/AGENTS.md", drop: "docs/rules.md" },
  { name: "the blob of a link is missing", path: "CLAUDE.md", drop: "CLAUDE.md" },
  { name: "a tree on the target path is missing", path: "src/AGENTS.md", drop: "docs" },
  {
    name: "the blob of a folder link is missing",
    make: folderRepo,
    path: "CLAUDE.md",
    drop: "docs",
  },
  { name: "GIT_DIR is not a repository", path: "AGENTS.md", gitDir: "not-a-repo" },
];

function failingRepo(failure: GitFailure): Repo & { readonly failureEnv: Env } {
  const fixture = (failure.make ?? instructionRepo)();
  if (failure.drop !== undefined) dropObject(fixture.repo, `${fixture.base}:${failure.drop}`);
  const failureEnv: Env =
    failure.gitDir === undefined ? {} : { GIT_DIR: join(fixture.root, failure.gitDir) };
  return { ...fixture, failureEnv };
}

describe.skipIf(!PLAN_CLI_HOST_SUPPORTED)("base instructions", () => {
  it(
    "the plan-manager base-instructions block copies the target text of each symlink",
    () => {
      for (const fixture of FIXTURES) {
        const { result, folder } = buildFolder(fixture.make());
        expect(result.status, `${fixture.name}: ${result.stderr}`).toBe(0);
        const manifest = [...fixture.expected]
          .map(([file, text]) => `${text === null ? "absent" : "copied"} ${file}\n`)
          .join("");
        expect(readFileSync(join(folder, "MANIFEST"), "utf8"), fixture.name).toBe(manifest);
        for (const [file, text] of fixture.expected) {
          const copy = join(folder, ...file.split("/"));
          if (text === null) expect(existsSync(copy), `${file} is not copied`).toBe(false);
          else {
            expect(lstatSync(copy).isFile(), `${file} is a regular file`).toBe(true);
            expect(readFileSync(copy, "utf8"), `${file} holds the base text of its target`).toBe(
              text,
            );
          }
        }
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "the code-review base read prints the target text of a symlink and exits 1 for a bad link",
    () => {
      for (const fixture of FIXTURES) {
        const { repo, base, env } = fixture.make();
        for (const [file, text] of [...fixture.expected, ...fixture.extra]) {
          const result = sh(repo, baseRead(base, file), env);
          expect(result.status, `${fixture.name} ${file}: ${result.stderr}`).toBe(
            text === null ? 1 : 0,
          );
          expect(result.stdout, `${fixture.name} ${file} gives the base text of its target`).toBe(
            text ?? "",
          );
        }
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a git failure stops the plan-manager block with an error and no MANIFEST",
    () => {
      for (const failure of GIT_FAILURES) {
        const fixture = failingRepo(failure);
        const { result, folder } = buildFolder(fixture, fixture.failureEnv);
        expect(result.status, `${failure.name}: the block fails`).not.toBe(0);
        expect(result.stderr, `${failure.name}: stderr`).toMatch(
          /base instructions: a read failed/,
        );
        expect(existsSync(join(folder, "MANIFEST")), `${failure.name}: no MANIFEST`).toBe(false);
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a git failure gives the code-review base read a status other than 0 and 1",
    () => {
      for (const failure of GIT_FAILURES) {
        const { repo, base, env, failureEnv } = failingRepo(failure);
        const result = sh(repo, baseRead(base, failure.path), { ...env, ...failureEnv });
        expect([0, 1], `${failure.name}: status ${result.status}`).not.toContain(result.status);
        expect(result.stdout, `${failure.name}: no text`).toBe("");
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  // A helper that cannot start is a failure, not an absent file.
  it(
    "a missing base-blob helper stops both reads with a status other than 0 and 1",
    () => {
      const fixture = instructionRepo();
      const missing = missingHelper(fixture.root);
      const { result, folder } = buildFolder(fixture, {}, missing);
      expect(result.status, "the block fails").not.toBe(0);
      expect(result.stderr).toMatch(/base instructions: a read failed/);
      expect(existsSync(join(folder, "MANIFEST")), "no MANIFEST").toBe(false);
      const read = sh(fixture.repo, baseRead(fixture.base, "AGENTS.md", missing), {
        ...fixture.env,
        ...missing.env,
      });
      expect([0, 1], `status ${read.status}`).not.toContain(read.status);
      expect(read.stdout).toBe("");
    },
    SPAWN_TIMEOUT_MS,
  );
});
