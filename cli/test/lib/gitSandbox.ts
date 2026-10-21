import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOUR_MS = 3_600_000;

/** Commit identity flags, so that no global or system git config is needed. */
const IDENTITY = [
  "-c",
  "user.name=Test",
  "-c",
  "user.email=test@example.com",
  "-c",
  "commit.gpgsign=false",
];

/**
 * Variables that the sandbox sets or clears. A git hook exports `GIT_DIR` and
 * `GIT_INDEX_FILE`, and they would point every sandbox command at the caller's
 * repository.
 */
const GIT_ENV_KEYS = [
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
] as const;

export interface SandboxWorktrees {
  /** `-b merged`, one commit merged into `origin/main`; clean; idle 48 h. */
  readonly merged: string;
  /** `-b wip`, one unpushed commit; idle 48 h. */
  readonly wip: string;
  /** `-b dirty` plus an untracked file; idle 48 h. */
  readonly dirty: string;
  /** Detached at `main`; fresh admin files. */
  readonly recent: string;
  /** Detached at `main`; idle 48 h. */
  readonly busy: string;
}

export interface GitSandbox {
  readonly base: string;
  readonly home: string;
  readonly remote: string;
  readonly main: string;
  readonly worktreeRoot: string;
  readonly scratchRoot: string;
  readonly worktrees: SandboxWorktrees;
  /** A path under the worktree root that does not exist. */
  readonly gone: string;
  /** A merged local branch that no worktree checks out. */
  readonly doneBranch: string;
  readonly git: (cwd: string, ...args: ReadonlyArray<string>) => string;
  /** Restore the git variables and delete the sandbox. */
  readonly dispose: () => void;
}

/** The admin directory that `<worktree>/.git` names. */
export function adminDirectory(worktree: string): string {
  const text = readFileSync(join(worktree, ".git"), "utf8");
  return resolve(worktree, text.slice("gitdir: ".length).trim());
}

/** Set the mtime of the admin files of `worktree` to `ageMs` ago. */
export function ageAdminFiles(worktree: string, ageMs: number): void {
  const admin = adminDirectory(worktree);
  const time = new Date(Date.now() - ageMs);
  for (const file of ["HEAD", "index", join("logs", "HEAD")]) {
    const path = join(admin, file);
    if (existsSync(path)) utimesSync(path, time, time);
  }
}

/**
 * A bare `remote.git`, a clone `main` with `origin/main`, and five linked
 * worktrees under `<base>/worktrees/repo/`. Git reads only an empty global
 * config file and no system config while the sandbox lives.
 */
export function createGitSandbox(): GitSandbox {
  // The native real path also expands a Windows 8.3 short name (`RUNNER~1`),
  // so sandbox paths equal the long paths that git prints on every host.
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), "tidy-")));
  const saved = new Map(GIT_ENV_KEYS.map((key) => [key, process.env[key]]));
  const globalConfig = join(base, "gitconfig");
  writeFileSync(globalConfig, "");
  for (const key of GIT_ENV_KEYS) delete process.env[key];
  process.env["GIT_CONFIG_GLOBAL"] = globalConfig;
  process.env["GIT_CONFIG_NOSYSTEM"] = "1";

  const git = (cwd: string, ...args: ReadonlyArray<string>): string => {
    const result = spawnSync("git", [...IDENTITY, ...args], { cwd, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(
        `git ${args.join(" ")} failed in ${cwd}: ${result.stderr}${result.error?.message ?? ""}`,
      );
    }
    return result.stdout;
  };
  const commit = (cwd: string, file: string, message: string): void => {
    writeFileSync(join(cwd, file), `${message}\n`);
    git(cwd, "add", "--", file);
    git(cwd, "commit", "-q", "-m", message);
  };

  const home = join(base, "home");
  const scratchRoot = join(base, "scratch");
  const worktreeRoot = join(base, "worktrees");
  const repoRoot = join(worktreeRoot, "repo");
  for (const directory of [home, scratchRoot, repoRoot]) mkdirSync(directory, { recursive: true });
  // Like `createScratchDir`: `removeTemporaryPath` refuses an entry below a root
  // that group or others can write, and the umask of the test run decides the
  // mode of a new directory.
  chmodSync(scratchRoot, 0o700);

  const remote = join(base, "remote.git");
  const main = join(base, "main");
  git(base, "init", "-q", "--bare", "--initial-branch=main", remote);
  git(base, "init", "-q", "--initial-branch=main", main);
  commit(main, "README", "init");
  git(main, "remote", "add", "origin", remote);
  git(main, "push", "-q", "origin", "main");

  const worktrees: SandboxWorktrees = {
    merged: join(repoRoot, "merged"),
    wip: join(repoRoot, "wip"),
    dirty: join(repoRoot, "dirty"),
    recent: join(repoRoot, "recent"),
    busy: join(repoRoot, "busy"),
  };
  git(main, "worktree", "add", "-q", "-b", "merged", worktrees.merged, "main");
  commit(worktrees.merged, "merged.txt", "merged work");
  git(main, "merge", "-q", "--ff-only", "merged");
  git(main, "push", "-q", "origin", "main");
  const doneBranch = "done";
  git(main, "branch", doneBranch);

  git(main, "worktree", "add", "-q", "-b", "wip", worktrees.wip, "main");
  commit(worktrees.wip, "wip.txt", "unpushed work");
  git(main, "worktree", "add", "-q", "-b", "dirty", worktrees.dirty, "main");
  writeFileSync(join(worktrees.dirty, "untracked.txt"), "draft\n");
  git(main, "worktree", "add", "-q", "--detach", worktrees.recent, "main");
  git(main, "worktree", "add", "-q", "--detach", worktrees.busy, "main");
  for (const worktree of [worktrees.merged, worktrees.wip, worktrees.dirty, worktrees.busy]) {
    ageAdminFiles(worktree, 48 * HOUR_MS);
  }

  return {
    base,
    home,
    remote,
    main,
    worktreeRoot,
    scratchRoot,
    worktrees,
    gone: join(repoRoot, "gone"),
    doneBranch,
    git,
    dispose: () => {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(base, { recursive: true, force: true });
    },
  };
}
