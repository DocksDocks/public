/**
 * Raw path bytes for `docks-kit plan`. A path is held as a string with one character per byte (latin1), so a byte
 * that is not UTF-8 stays itself. The runtime decodes its arguments and `process.cwd()` as UTF-8 and puts U+FFFD in
 * place of each byte that is not UTF-8, which cannot be told from a literal U+FFFD. On Linux, `/proc/self/cmdline`
 * and `/proc/self/cwd` give the bytes. macOS paths and Windows arguments are Unicode, so there the runtime strings are
 * exact. On another system without those files, a string with a U+FFFD has unknown bytes, and its use fails closed.
 */
import path from "node:path";

import { Effect } from "effect";

import { PlanFiles } from "./services";

/** The bytes, or why they cannot be known. */
export type Recovered<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly cause: string };

const ARGUMENT_WITHOUT_PROC = "the bytes of an argument cannot be recovered without /proc";
const ARGUMENT_UNMATCHED =
  "the bytes of an argument cannot be recovered: /proc/self/cmdline does not match the arguments";
const WORKING_FOLDER_WITHOUT_PROC =
  "the bytes of the working folder cannot be recovered without /proc";

// Whether a path of this system is bytes that need not be UTF-8.
const PATHS_ARE_BYTES = process.platform !== "darwin" && process.platform !== "win32";

/** The /proc folder; `PLAN_CLI_PROC_ROOT` (a test hook) names another, such as an empty folder for a missing /proc. */
const procFile = (name: string): string =>
  path.join(process.env["PLAN_CLI_PROC_ROOT"] || "/proc", "self", name);

/** A string of this process (UTF-8 text) as one character per byte. */
export const asBytes = (text: string): string => Buffer.from(text, "utf8").toString("latin1");

/** The text of a byte string when its bytes are UTF-8, or undefined when they are not. */
export const utf8Text = (bytes: string): string | undefined => {
  const text = Buffer.from(bytes, "latin1").toString("utf8");
  return asBytes(text) === bytes ? text : undefined;
};

// A run of U+FFFD, which one invalid sequence or several give, depending on the decoder.
const REPLACEMENTS = /\uFFFD+/g;

/**
 * The bytes of `args`, the last words of the command line of this process, one byte string each. Each word of
 * `/proc/self/cmdline` must decode to its argument, so a word maps to its argument and no other. Without a mapped
 * word, the text of an argument is its bytes unless it holds a U+FFFD on a system whose paths are bytes.
 */
export const argumentBytes = Effect.fn("plan.argumentBytes")(function* (
  args: ReadonlyArray<string>,
) {
  const files = yield* PlanFiles;
  const commandLine = yield* files.readBytes(procFile("cmdline"));
  const lost = PATHS_ARE_BYTES && args.some((arg) => arg.includes("\uFFFD"));
  if (commandLine === undefined) {
    const recovered: Recovered<ReadonlyArray<string>> = lost
      ? { ok: false, cause: ARGUMENT_WITHOUT_PROC }
      : { ok: true, value: args.map(asBytes) };
    return recovered;
  }
  // Each word ends with a NUL.
  const words = commandLine.toString("latin1").split("\0").slice(0, -1);
  const tail = args.length === 0 ? [] : words.slice(-args.length);
  const decoded = (word: string): string =>
    Buffer.from(word, "latin1").toString("utf8").replace(REPLACEMENTS, "\uFFFD");
  const matched =
    tail.length === args.length &&
    tail.every((word, index) => decoded(word) === args[index]?.replace(REPLACEMENTS, "\uFFFD"));
  const recovered: Recovered<ReadonlyArray<string>> = matched
    ? { ok: true, value: tail }
    : lost
      ? { ok: false, cause: ARGUMENT_UNMATCHED }
      : { ok: true, value: args.map(asBytes) };
  return recovered;
});

/** The bytes of the working folder of this process. */
export const workingFolderBytes = Effect.fn("plan.workingFolderBytes")(function* () {
  const files = yield* PlanFiles;
  const target = yield* files.linkTarget(procFile("cwd"));
  const cwd = process.cwd();
  const recovered: Recovered<string> =
    target !== undefined
      ? { ok: true, value: target.toString("latin1") }
      : PATHS_ARE_BYTES && cwd.includes("\uFFFD")
        ? { ok: false, cause: WORKING_FOLDER_WITHOUT_PROC }
        : { ok: true, value: asBytes(cwd) };
  return recovered;
});
