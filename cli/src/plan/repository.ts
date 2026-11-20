/**
 * Local folders of `docks-kit plan`: the `docks-review` folder of the git repository that holds the working directory,
 * and the private state folder for the temporary body files of gh writes.
 */
import os from "node:os";
import path from "node:path";

import { Effect } from "effect";

import { PlanFiles, PlanProcess } from "./services";
import { GitError } from "./types";

/** `git rev-parse --git-path docks-review`, resolved from the working directory. */
export const reviewDirectory = Effect.fn("plan.reviewDirectory")(function* () {
  const processes = yield* PlanProcess;
  const result = yield* processes.run("git", ["rev-parse", "--git-path", "docks-review"]);
  if (result.error?.code === "ENOENT")
    return yield* new GitError({ message: "git is not installed or not on PATH" });
  if (result.error)
    return yield* new GitError({ message: `git rev-parse failed: ${result.error.message}` });
  if (result.status !== 0)
    return yield* new GitError({
      message: `git rev-parse failed: ${result.stderr.trim() || `exit ${result.status}`}`,
    });
  const gitPath = result.stdout.trim();
  if (!gitPath) return yield* new GitError({ message: "git rev-parse failed: empty git path" });
  return path.resolve(process.cwd(), gitPath);
});

/** `$XDG_STATE_HOME/docks/plan` (default `~/.local/state/docks/plan`), created with mode 0700. */
export const stateDirectory = Effect.fn("plan.stateDirectory")(function* () {
  const files = yield* PlanFiles;
  const base =
    process.env["XDG_STATE_HOME"] ||
    path.join(process.env["HOME"] || os.homedir(), ".local", "state");
  const directory = path.join(base, "docks", "plan");
  yield* files.ensurePrivateDirectory(directory);
  return directory;
});
