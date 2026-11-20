/**
 * Local folders of `docks-kit plan`: the `docks-review` folder of the git repository that holds the working directory,
 * and the private state folder for the temporary body files of gh writes.
 */
import os from "node:os";
import path from "node:path";

import { Effect } from "effect";

import { workingFolderBytes } from "./bytes";
import { PlanFiles, PlanProcess } from "./services";
import { GitError } from "./types";

/**
 * `git rev-parse --git-path docks-review`, resolved from the working directory, as a byte string (one character per
 * byte): git prints the path as bytes, and the working folder is read as bytes, so a path that is not UTF-8 and a
 * path with a literal U+FFFD both keep their bytes.
 */
export const reviewDirectory = Effect.fn("plan.reviewDirectory")(function* () {
  const processes = yield* PlanProcess;
  const result = yield* processes.run("git", ["rev-parse", "--git-path", "docks-review"], {
    encoding: "latin1",
  });
  if (result.error?.code === "ENOENT")
    return yield* new GitError({ message: "git is not installed or not on PATH" });
  if (result.error)
    return yield* new GitError({ message: `git rev-parse failed: ${result.error.message}` });
  if (result.status !== 0) {
    const detail = Buffer.from(result.stderr, "latin1").toString("utf8").trim();
    return yield* new GitError({
      message: `git rev-parse failed: ${detail || `exit ${result.status}`}`,
    });
  }
  // ASCII white space only: a trim of all white space would also cut the byte 0xa0 that ends a UTF-8 character.
  const gitPath = result.stdout.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, "");
  if (!gitPath) return yield* new GitError({ message: "git rev-parse failed: empty git path" });
  return path.resolve(yield* workingFolderBytes(), gitPath);
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
