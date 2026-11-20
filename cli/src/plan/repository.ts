/**
 * Local folders of `docks-kit plan`: the `docks-review` folder of the git repository that holds the working directory,
 * and the private state folder for the temporary body files of gh writes.
 */
import os from "node:os";
import path from "node:path";

import { Effect } from "effect";

import { LOST_BYTE, PlanFiles, PlanProcess, utf8Text } from "./services";
import { GitError } from "./types";

const NOT_UTF8 = "the docks-review folder path is not UTF-8 text";

/**
 * `git rev-parse --git-path docks-review`, resolved from the working directory. git prints the path as bytes, and a
 * path whose bytes are not UTF-8, or a relative path from a working folder whose name Node decoded with U+FFFD in
 * place of a byte, would name another folder, so either fails closed.
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
  // Decoded before the trim: a trim of latin1 text would also cut the byte 0xa0 that ends a UTF-8 character.
  const output = utf8Text(result.stdout);
  if (output === undefined) return yield* new GitError({ message: NOT_UTF8 });
  const gitPath = output.trim();
  if (!gitPath) return yield* new GitError({ message: "git rev-parse failed: empty git path" });
  const cwd = process.cwd();
  if (!path.isAbsolute(gitPath) && cwd.includes(LOST_BYTE))
    return yield* new GitError({ message: NOT_UTF8 });
  return path.resolve(cwd, gitPath);
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
