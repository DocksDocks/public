/**
 * `docks-kit agent-docs pr-template detect | gate`: find the pull-request templates that GitHub reads, and gate the
 * write of a new `.github/pull_request_template.md`. GitHub reads a template from the root, from `docs/`, or from
 * `.github/`: a file named `pull_request_template`, `pull_request_template.md`, or `pull_request_template.txt` in any
 * letter case, or a `PULL_REQUEST_TEMPLATE` folder that holds a `.md` or `.txt` file. The rules and the meaning of each
 * line live in the plan-workspace reference `pull-request-template.md`.
 *
 * Output lines:
 *   detect  one `pull-request template: <path> (<kind>)` line for each usable entry, one
 *           `pull-request template: unusable <path> (<reason>)` line for each unusable entry, and
 *           `pull-request template: none` when no entry is usable. Folders in the order `.`, `docs`, `.github`;
 *           inside a folder, by byte order of the name. Paths are relative to the repository root.
 *   gate    exactly one of `target occupied: write nothing`, `target free`, or
 *           `no write: a usable template exists, or .github is a symlink`.
 *   Either command prints `ERROR pull-request template check failed (see the message above)` when the check cannot
 *   finish, for example outside a git repository; the cause is on stderr.
 *
 * Exit status: 2 after an ERROR line, 1 for a usage error, otherwise 0.
 */
import path from "node:path";

import { Effect } from "effect";

import { byteOrder, UsageError } from "./shared";
import {
  AgentDocsFiles,
  AgentDocsGit,
  errorDetail,
  type FolderEntry,
  printLines,
  writeStderr,
} from "./services";

const USAGE = "usage: docks-kit agent-docs pr-template detect | gate";
const ERROR_LINE = "ERROR pull-request template check failed (see the message above)";
const NONE_LINE = "pull-request template: none";
const TEMPLATE_FOLDERS: ReadonlyArray<string> = [".", "docs", ".github"];
const TEMPLATE_NAMES: ReadonlySet<string> = new Set([
  "pull_request_template",
  "pull_request_template.md",
  "pull_request_template.txt",
]);
// Only this name makes a folder a template folder; a folder with a file name is unusable.
const FOLDER_NAME = "pull_request_template";
// Any entry with a supported name occupies the target, also an unusable one.
const TARGET_OCCUPIED =
  /^pull-request template: (unusable )?\.github\/pull_request_template\.md \(/iu;

/** The detect lines; on `ok: false`, the lines found before the failure, whose cause is on stderr. */
export interface PrTemplateResult {
  readonly ok: boolean;
  readonly lines: ReadonlyArray<string>;
}

interface Classified {
  readonly usable: boolean;
  readonly line: string;
}

/**
 * The repository root that `git rev-parse --show-toplevel` prints for `cwd`, or null when git fails; git's own
 * message then is on stderr.
 */
const gitRoot = Effect.fn("prTemplate.gitRoot")(function* (cwd: string) {
  const git = yield* AgentDocsGit;
  const result = yield* git.run(["rev-parse", "--show-toplevel"], cwd);
  if (result.error !== undefined) {
    yield* writeStderr(
      `pr-template: cannot run git rev-parse (${result.error.message}); install git and retry\n`,
    );
    return null;
  }
  yield* writeStderr(result.stderr);
  return result.status === 0 ? result.stdout.replace(/\n+$/u, "") : null;
});

/**
 * The entries of a folder, or null after a message on stderr: an unreadable folder leaves the answer open, so the
 * caller must not report "none".
 */
const readFolder = Effect.fn("prTemplate.readFolder")(function* (folder: string, shown: string) {
  const files = yield* AgentDocsFiles;
  return yield* files
    .readFolder(folder)
    .pipe(
      Effect.catchTag("FileError", (error) =>
        writeStderr(
          `pr-template: cannot list the folder ${shown} (${errorDetail(error)}); make it readable and run the check again\n`,
        ).pipe(Effect.as<ReadonlyArray<FolderEntry> | null>(null)),
      ),
    );
});

/**
 * A template folder is usable when it holds a regular `.md` or `.txt` file itself; a symlink inside the folder does
 * not count. Null when the folder cannot be read.
 */
const holdsTemplateFile = Effect.fn("prTemplate.holdsTemplateFile")(function* (
  folder: string,
  shown: string,
) {
  const entries = yield* readFolder(folder, shown);
  if (entries === null) return null;
  return entries.some((entry) => entry.kind === "file" && /\.(md|txt)$/iu.test(entry.name));
});

/** Classify one entry with a supported name; null when a folder inside it cannot be read. */
const classify = Effect.fn("prTemplate.classify")(function* (
  root: string,
  shown: string,
  name: string,
) {
  const files = yield* AgentDocsFiles;
  const file = path.join(root, shown);
  const via = (yield* files.isSymlink(file)) ? "symlink to " : "";
  const stat = yield* files.stat(file);
  let classified: Classified;
  if (stat === "file") {
    classified = { usable: true, line: `pull-request template: ${shown} (${via}file)` };
  } else if (stat === "directory" && name.toLowerCase() === FOLDER_NAME) {
    const holds = yield* holdsTemplateFile(file, `${shown}/`);
    if (holds === null) return null;
    classified = holds
      ? { usable: true, line: `pull-request template: ${shown} (${via}folder)` }
      : {
          usable: false,
          line: `pull-request template: unusable ${shown} (${via}folder without a .md or .txt file)`,
        };
  } else if (stat === "directory") {
    classified = {
      usable: false,
      line: `pull-request template: unusable ${shown} (${via}folder with a file name)`,
    };
  } else if (via) {
    classified = {
      usable: false,
      line: `pull-request template: unusable ${shown} (broken symlink)`,
    };
  } else {
    classified = {
      usable: false,
      line: `pull-request template: unusable ${shown} (not a regular file)`,
    };
  }
  return classified;
});

/**
 * The detect lines for the repository at `root` (absolute), or at the git root of the current folder when `root` is
 * null.
 */
export const prTemplateLines = Effect.fn("prTemplate.lines")(function* (root: string | null) {
  const files = yield* AgentDocsFiles;
  const top = root ?? (yield* gitRoot(yield* files.workingFolder));
  const lines: Array<string> = [];
  const failed = (): PrTemplateResult => ({ ok: false, lines });
  if (top === null) return failed();
  let usable = false;
  for (const dir of TEMPLATE_FOLDERS) {
    const folder = path.join(top, dir);
    if ((yield* files.stat(folder)) !== "directory") continue;
    // `find <dir>` does not descend into a starting point that is a symlink, so a linked `docs` or `.github` lists
    // no entry.
    if (yield* files.isSymlink(folder)) continue;
    const entries = yield* readFolder(folder, dir);
    if (entries === null) return failed();
    // The supported names are ASCII, so byte order is the order of the default sort.
    const names = entries
      .map((entry) => entry.name)
      .filter((name) => TEMPLATE_NAMES.has(name.toLowerCase()))
      .sort(byteOrder);
    for (const name of names) {
      const entry = yield* classify(top, `${dir}/${name}`, name);
      if (entry === null) return failed();
      usable ||= entry.usable;
      lines.push(entry.line);
    }
  }
  if (!usable) lines.push(NONE_LINE);
  const result: PrTemplateResult = { ok: true, lines };
  return result;
});

/** The write gate for `.github/pull_request_template.md`: one line from the detect lines. */
const gateLine = Effect.fn("prTemplate.gateLine")(function* (
  top: string,
  lines: ReadonlyArray<string>,
) {
  const files = yield* AgentDocsFiles;
  if (lines.some((line) => TARGET_OCCUPIED.test(line))) return "target occupied: write nothing";
  if (lines.at(-1) === NONE_LINE && !(yield* files.isSymlink(path.join(top, ".github"))))
    return "target free";
  return "no write: a usable template exists, or .github is a symlink";
});

/** Run `pr-template <args>` and return its exit status; a usage error fails with UsageError. */
export const runPrTemplate = Effect.fn("prTemplate.run")(function* (args: ReadonlyArray<string>) {
  const [command, ...rest] = args;
  if ((command !== "detect" && command !== "gate") || rest.length > 0)
    return yield* new UsageError({ usage: USAGE });
  const files = yield* AgentDocsFiles;
  const top = yield* gitRoot(yield* files.workingFolder);
  const result = top === null ? { ok: false, lines: [] } : yield* prTemplateLines(top);
  if (top === null || !result.ok) {
    // The shell wrapper dropped the lines found before the failure; print only the ERROR line.
    yield* printLines([ERROR_LINE]);
    return 2;
  }
  yield* printLines(command === "detect" ? result.lines : [yield* gateLine(top, result.lines)]);
  return 0;
});
