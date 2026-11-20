/**
 * The checkout-state helper of plan-manager, which the practice Delegated work
 * runs before and after a dispatch. Two listings of the session checkout must
 * differ in the line of each path that changed on disk, and in no other line,
 * also when the checkout was dirty before the dispatch. `entry.ts` selects the
 * helper: `sh checkout-state.sh` or `docks-kit plan checkout-state`.
 */
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";

import { COMMAND_WORD, PLAN_CLI_ENTRY, checkoutHelperInvocation } from "../../lib/plan/entry";
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
  GIT_AUTHOR_NAME: "Checkout state test",
  GIT_AUTHOR_EMAIL: "checkout-state@example.invalid",
  GIT_COMMITTER_NAME: "Checkout state test",
  GIT_COMMITTER_EMAIL: "checkout-state@example.invalid",
  LC_ALL: "C",
};

// The usage line names the helper (decision 5a).
const USAGE =
  PLAN_CLI_ENTRY === "plan.mjs"
    ? "usage: sh checkout-state.sh <checkout>"
    : `usage: ${COMMAND_WORD} checkout-state <checkout>`;

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

function commitAll(repo: string, message: string): void {
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", message);
}

function newRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "checkout-state-")));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function newRepo(root: string, name = "repo"): string {
  const repo = join(root, name);
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  return repo;
}

// A committed repository: a.txt is dirty, b.txt is clean, notes.txt is untracked, and .gitignore ignores *.log.
function dirtyRepo(): { readonly root: string; readonly repo: string } {
  const root = newRoot();
  const repo = newRepo(root);
  put(repo, ".gitignore", "*.log\n");
  put(repo, "a.txt", "a at the base\n");
  put(repo, "b.txt", "b at the base\n");
  put(repo, "src/c.txt", "c at the base\n");
  commitAll(repo, "base");
  put(repo, "a.txt", "a of the user\n");
  put(repo, "notes.txt", "untracked notes\n");
  return { root, repo };
}

function runHelper(args: ReadonlyArray<string>, env: Env = {}): SpawnSyncReturns<string> {
  const invocation = checkoutHelperInvocation("checkout-state", args);
  return spawnSync(invocation.file, invocation.args, {
    env: { ...GIT_ENV, ...invocation.env, ...env },
    encoding: "utf8",
  });
}

function run(dir: string, env: Env = {}): SpawnSyncReturns<string> {
  return runHelper([dir], env);
}

function listing(dir: string): string {
  const result = run(dir);
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

function linesOf(text: string): ReadonlyArray<string> {
  return text.split("\n").filter((line) => line !== "");
}

function pathOf(line: string): string {
  return line.split("\t")[0] ?? "";
}

// The path of each line that is in one listing only, as `diff` of the two listings names them.
function changedPaths(before: string, after: string): ReadonlyArray<string> {
  const old = new Set(linesOf(before));
  const now = new Set(linesOf(after));
  const changed = [...old]
    .filter((line) => !now.has(line))
    .concat([...now].filter((line) => !old.has(line)));
  return [...new Set(changed.map(pathOf))].sort();
}

function lineOf(text: string, file: string): string {
  const found = linesOf(text).filter((line) => pathOf(line) === file);
  expect(found.length, `one line for ${file}`).toBe(1);
  return found[0] ?? "";
}

function expectFails(result: SpawnSyncReturns<string>, name: string): void {
  expect(result.status, `${name}: status ${result.status}`).not.toBe(0);
  expect(result.stdout, `${name}: no output`).toBe("");
}

// The submodule mod holds x.txt, which is clean, and y.txt, which is dirty before the first listing.
function submoduleRepo(): { readonly root: string; readonly repo: string; readonly mod: string } {
  const { root, repo } = dirtyRepo();
  const mod = join(repo, "mod");
  mkdirSync(mod);
  git(mod, "init", "-q", "-b", "main");
  put(mod, "x.txt", "x at the base\n");
  put(mod, "y.txt", "y at the base\n");
  commitAll(mod, "module base");
  git(repo, "-c", "advice.addEmbeddedRepo=false", "add", "mod");
  git(repo, "commit", "-q", "-m", "add mod");
  put(mod, "y.txt", "y of the user\n");
  return { root, repo, mod };
}

describe.skipIf(!PLAN_CLI_HOST_SUPPORTED)("checkout state", () => {
  it(
    "two listings of an unchanged dirty checkout are the same, sorted, with raw blob ids",
    () => {
      const { repo } = dirtyRepo();
      link(repo, "to-a", "a.txt");
      const first = listing(repo);
      expect(listing(repo)).toBe(first);
      expect(listing(join(repo, "src")), "a folder of the checkout lists the whole checkout").toBe(
        first,
      );
      const lines = linesOf(first);
      expect(lines, "the lines are sorted").toStrictEqual([...lines].sort());
      expect(lines.map(pathOf)).toStrictEqual([
        ".gitignore",
        "a.txt",
        "b.txt",
        "notes.txt",
        "src/c.txt",
        "to-a",
      ]);
      expect(lineOf(first, "a.txt")).toBe(
        `a.txt\t${git(repo, "hash-object", "--no-filters", "a.txt").trim()}`,
      );
      expect(lineOf(first, "to-a")).toBe("to-a\tlink\ta.txt");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a change of each kind changes the line of its path only",
    () => {
      const cases: ReadonlyArray<{
        readonly name: string;
        readonly path: string;
        readonly change: (repo: string) => void;
      }> = [
        {
          name: "a second change of a dirty tracked file",
          path: "a.txt",
          change: (repo) => put(repo, "a.txt", "again\n"),
        },
        {
          name: "a new untracked file",
          path: "new.txt",
          change: (repo) => put(repo, "new.txt", "new\n"),
        },
        {
          name: "a change of an untracked file",
          path: "notes.txt",
          change: (repo) => put(repo, "notes.txt", "x\n"),
        },
        {
          name: "a deleted tracked file",
          path: "b.txt",
          change: (repo) => rmSync(join(repo, "b.txt")),
        },
        {
          name: "chmod +x of a tracked file",
          path: "b.txt",
          change: (repo) => chmodSync(`${repo}/b.txt`, 0o755),
        },
      ];
      for (const { name, path: file, change } of cases) {
        const { repo } = dirtyRepo();
        const before = listing(repo);
        change(repo);
        const after = listing(repo);
        expect(changedPaths(before, after), name).toStrictEqual([file]);
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  // git hash-object --stdin-paths reads a line that starts with `"` as a C-quoted path, and it drops a carriage
  // return at the end of a line. The helper quotes each path, so these valid names keep each byte.
  it(
    "a name with a double quote, a backslash, or a carriage return has one line, and a change changes only it",
    () => {
      const names = ['"quoted.txt', "back\\slash.txt", "carriage\r"];
      for (const name of names) {
        for (const tracked of [false, true]) {
          const label = `${JSON.stringify(name)}, ${tracked ? "tracked" : "untracked"}`;
          const { repo } = dirtyRepo();
          put(repo, name, "first\n");
          if (tracked) {
            git(repo, "add", "--", name);
            git(repo, "commit", "-q", "-m", "add the name");
          }
          const before = listing(repo);
          const blob = git(repo, "hash-object", "--no-filters", "--", name).trim();
          expect(lineOf(before, name), label).toBe(`${name}\t${blob}`);
          put(repo, name, "second\n");
          expect(changedPaths(before, listing(repo)), label).toStrictEqual([name]);
        }
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a deleted tracked file is missing, and an executable file has the x field",
    () => {
      const { repo } = dirtyRepo();
      rmSync(join(repo, "b.txt"));
      chmodSync(join(repo, "src/c.txt"), 0o755);
      const state = listing(repo);
      expect(lineOf(state, "b.txt")).toBe("b.txt\tmissing");
      expect(lineOf(state, "src/c.txt")).toMatch(/^src\/c\.txt\t[0-9a-f]{40,64}\tx$/);
    },
    SPAWN_TIMEOUT_MS,
  );

  // Under `* text=auto`, git status and git diff do not show a change of the line endings only.
  it(
    "a line-ending-only change under text=auto changes the line of a tracked and of an untracked file",
    () => {
      const root = newRoot();
      const repo = newRepo(root);
      put(repo, ".gitattributes", "* text=auto\n");
      put(repo, "tracked.txt", "one\ntwo\n");
      commitAll(repo, "base");
      put(repo, "untracked.txt", "one\ntwo\n");
      const before = listing(repo);
      put(repo, "tracked.txt", "one\r\ntwo\r\n");
      put(repo, "untracked.txt", "one\r\ntwo\r\n");
      expect(changedPaths(before, listing(repo))).toStrictEqual(["tracked.txt", "untracked.txt"]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an untracked link pointed at another file with the same content changes its line",
    () => {
      const { repo } = dirtyRepo();
      put(repo, "one.txt", "same\n");
      put(repo, "two.txt", "same\n");
      link(repo, "pointer", "one.txt");
      const before = listing(repo);
      rmSync(join(repo, "pointer"));
      link(repo, "pointer", "two.txt");
      const after = listing(repo);
      expect(changedPaths(before, after)).toStrictEqual(["pointer"]);
      expect(lineOf(after, "pointer")).toBe("pointer\tlink\ttwo.txt");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a dangling link is listed with its target, with status 0",
    () => {
      const { repo } = dirtyRepo();
      link(repo, "dangling", "nowhere/at/all");
      expect(lineOf(listing(repo), "dangling")).toBe("dangling\tlink\tnowhere/at/all");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an edit inside a checked-out submodule changes the line of that file",
    () => {
      const { repo, mod } = submoduleRepo();
      const before = listing(repo);
      expect(lineOf(before, "mod")).toBe(`mod\tsubmodule\t${git(mod, "rev-parse", "HEAD").trim()}`);
      expect(lineOf(before, "mod/y.txt")).toBe(
        `mod/y.txt\t${git(mod, "hash-object", "--no-filters", "y.txt").trim()}`,
      );
      put(mod, "x.txt", "x of a subagent\n");
      const after = listing(repo);
      expect(changedPaths(before, after)).toStrictEqual(["mod/x.txt"]);
      put(mod, "y.txt", "y of a subagent\n");
      expect(
        changedPaths(after, listing(repo)),
        "a second edit of a dirty submodule file",
      ).toStrictEqual(["mod/y.txt"]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a submodule that is not checked out is special",
    () => {
      const root = newRoot();
      const repo = newRepo(root);
      put(repo, "a.txt", "a\n");
      git(repo, "add", "-A");
      git(repo, "update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},mod`);
      git(repo, "commit", "-q", "-m", "base");
      mkdirSync(join(repo, "mod"));
      expect(lineOf(listing(repo), "mod")).toBe("mod\tspecial");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an ignored file has no line, and its change changes nothing",
    () => {
      const { repo } = dirtyRepo();
      put(repo, "build.log", "first\n");
      const before = listing(repo);
      expect(linesOf(before).filter((line) => line.startsWith("build.log\t"))).toHaveLength(0);
      put(repo, "build.log", "second\n");
      expect(listing(repo)).toBe(before);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an unmerged path has one line",
    () => {
      const root = newRoot();
      const repo = newRepo(root);
      put(repo, "f.txt", "base\n");
      commitAll(repo, "base");
      git(repo, "switch", "-q", "-c", "other");
      put(repo, "f.txt", "other\n");
      commitAll(repo, "other");
      git(repo, "switch", "-q", "main");
      put(repo, "f.txt", "main\n");
      commitAll(repo, "main");
      const merge = spawnSync("git", ["merge", "-q", "other"], {
        cwd: repo,
        env: GIT_ENV,
        encoding: "utf8",
      });
      expect(merge.status, "the merge stops on a conflict").not.toBe(0);
      expect(git(repo, "ls-files", "--cached", "f.txt").split("\n").filter(Boolean)).toHaveLength(
        3,
      );
      lineOf(listing(repo), "f.txt");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a newline in a link target or a path, or a tab in a path, stops the helper with no output",
    () => {
      const cases: ReadonlyArray<{
        readonly name: string;
        readonly submodule?: boolean;
        readonly change: (repo: string) => void;
      }> = [
        {
          name: "a link target with a newline",
          change: (repo) => link(repo, "odd-link", "two\nlines"),
        },
        {
          name: "an untracked path with a newline",
          change: (repo) => put(repo, "odd\nname.txt", "x\n"),
        },
        {
          name: "an untracked path with a tab",
          change: (repo) => put(repo, "odd\tname.txt", "x\n"),
        },
        {
          name: "a newline in a submodule path",
          submodule: true,
          change: (repo) => put(repo, "mod/odd\nname", "x\n"),
        },
      ];
      for (const { name, submodule, change } of cases) {
        const { repo } = submodule === true ? submoduleRepo() : dirtyRepo();
        change(repo);
        expectFails(run(repo), name);
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a folder outside a git checkout and a wrong argument stop the helper with no output",
    () => {
      const root = newRoot();
      const plain = join(root, "plain");
      mkdirSync(plain);
      put(plain, "a.txt", "a\n");
      expectFails(run(plain, { GIT_CEILING_DIRECTORIES: root }), "a folder outside a checkout");
      expectFails(run(join(root, "absent")), "a folder that does not exist");
      const none = runHelper([]);
      expect(none.status, "no argument").toBe(2);
      expect(none.stderr).toContain(USAGE);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a git failure stops the helper with no output",
    () => {
      const { repo } = dirtyRepo();
      writeFileSync(join(repo, ".git", "index"), "not an index");
      expectFails(run(repo), "a broken index");
    },
    SPAWN_TIMEOUT_MS,
  );
});
