/**
 * `docks-kit agent-docs verify-skill detect | write-gate <path>... | entry-gate`: check the project `verify` skill and
 * guard each write that creates it. The skill lives at `.agents/skills/verify/SKILL.md`. The steps and the meaning of
 * each line live in the plan-workspace reference `verify-skill-template.md`. Run it from the repository root.
 *
 * Output lines:
 *   detect      `verify skill: present` or `verify skill: missing`; one `verify unverified: <n>:<line>` line for
 *               each line of the skill that holds `not observed:`; `ERROR verify skill check failed: cannot read
 *               <file>` when the skill cannot be read.
 *   write-gate  one `target occupied: <path> ...` line for each path that must not be written: a symlink, a path
 *               that holds a `..` segment, or a path whose nearest existing folder cannot be entered or resolves
 *               outside the current folder. Nothing for a writable path.
 *   entry-gate  `target occupied: .agents/skills/verify exists` when an entry is there, a dangling symlink included.
 *
 * Exit status: 2 after an ERROR line, 1 for a usage error, otherwise 0. `target occupied` lines do not change the
 * status.
 */
import path from "node:path";

import { Effect } from "effect";

import { UsageError } from "./shared";
import { AgentDocsFiles, errorDetail, printLines, writeStderr } from "./services";

const USAGE = "usage: docks-kit agent-docs verify-skill detect | write-gate <path>... | entry-gate";
const SKILL_DIR = ".agents/skills/verify";
const SKILL_FILE = `${SKILL_DIR}/SKILL.md`;
const UNVERIFIED_MARK = "not observed:";

/** The detect lines; on `ok: false`, `lines` still holds every line, the ERROR line included. */
export interface VerifySkillResult {
  readonly ok: boolean;
  readonly lines: ReadonlyArray<string>;
}

/** The detect lines for the current folder. On `ok: false`, the cause is on stderr. */
export const verifySkillLines = Effect.fn("verifySkill.lines")(function* () {
  const files = yield* AgentDocsFiles;
  const lines: Array<string> = [];
  let ok = true;
  if ((yield* files.stat(SKILL_FILE)) === "file") {
    lines.push("verify skill: present");
    const text = yield* files
      .readFile(SKILL_FILE, "utf8")
      .pipe(
        Effect.catchTag("FileError", (error) =>
          writeStderr(
            `verify-skill: cannot read ${SKILL_FILE} (${errorDetail(error)}); make it readable and run detect again\n`,
          ).pipe(Effect.as(null)),
        ),
      );
    if (text === null) {
      lines.push(`ERROR verify skill check failed: cannot read ${SKILL_FILE}`);
      ok = false;
    } else {
      // `grep -n` numbers lines from 1 and ends the last line at the end of the file.
      text
        .replace(/\n$/u, "")
        .split("\n")
        .forEach((line, index) => {
          if (line.includes(UNVERIFIED_MARK)) lines.push(`verify unverified: ${index + 1}:${line}`);
        });
    }
  } else {
    lines.push("verify skill: missing");
  }
  const result: VerifySkillResult = { ok, lines };
  return result;
});

/** The folder that `cd` would enter for `target`: its nearest existing ancestor folder. */
const nearestFolder = Effect.fn("verifySkill.nearestFolder")(function* (target: string) {
  const files = yield* AgentDocsFiles;
  let folder = path.dirname(target);
  while ((yield* files.stat(folder)) !== "directory") {
    const parent = path.dirname(folder);
    if (parent === folder) break;
    folder = parent;
  }
  return folder;
});

/**
 * The refusal for one path that a step wants to write, or null when the write may go on. A write must never go
 * through a symlink or land outside the repository.
 */
const refusal = Effect.fn("verifySkill.refusal")(function* (root: string, target: string) {
  const files = yield* AgentDocsFiles;
  if (yield* files.isSymlink(target)) return `target occupied: ${target} is a symlink`;
  // The kernel resolves `link/..` to the parent of the link target, while path.dirname and the nearest-folder search
  // remove `..` as text. No path with `..` passes, so both agree.
  if (target.split("/").includes("..")) return `target occupied: ${target} holds a .. segment`;
  const folder = yield* nearestFolder(target);
  // `cd` needs search permission on the folder; realpath alone does not check it. The native realpath resolves each
  // part as the kernel does; the JavaScript one removes `..` as text before it follows a symlink.
  const resolved = yield* files.canSearch(folder).pipe(
    Effect.andThen(files.realPathNative(folder)),
    Effect.catchTag("FileError", () => Effect.succeed(null)),
  );
  if (resolved === null) return `target occupied: cannot resolve the folder of ${target}`;
  if (!`${resolved}/`.startsWith(`${root}/`))
    return `target occupied: ${target} resolves outside the repository`;
  return null;
});

const writeGateLines = Effect.fn("verifySkill.writeGateLines")(function* (
  targets: ReadonlyArray<string>,
) {
  const files = yield* AgentDocsFiles;
  // The working folder is the physical path, as `pwd -P` prints it.
  const root = yield* files.workingFolder;
  const lines: Array<string> = [];
  for (const target of targets) {
    const line = yield* refusal(root, target);
    if (line !== null) lines.push(line);
  }
  return lines;
});

/** Run `verify-skill <args>` and return its exit status; a usage error fails with UsageError. */
export const runVerifySkill = Effect.fn("verifySkill.run")(function* (args: ReadonlyArray<string>) {
  const files = yield* AgentDocsFiles;
  const [command, ...rest] = args;
  let result: VerifySkillResult;
  if (command === "detect" && rest.length === 0) result = yield* verifySkillLines();
  else if (command === "write-gate" && rest.length > 0)
    result = { ok: true, lines: yield* writeGateLines(rest) };
  else if (command === "entry-gate" && rest.length === 0)
    result = {
      ok: true,
      lines: (yield* files.entryExists(SKILL_DIR)) ? [`target occupied: ${SKILL_DIR} exists`] : [],
    };
  else return yield* new UsageError({ usage: USAGE });
  yield* printLines(result.lines);
  return result.ok ? 0 : 2;
});
