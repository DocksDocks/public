/**
 * Raw path bytes for `docks-kit plan`. A path is held as a string with one character per byte (latin1), so a byte
 * that is not UTF-8 stays itself. The runtime decodes its arguments and `process.cwd()` as UTF-8 and puts U+FFFD in
 * place of each byte that is not UTF-8, which cannot be told from a literal U+FFFD. On Linux, `/proc/self/cmdline`
 * and `/proc/self/cwd` give the bytes. Where `/proc` is absent (macOS, Windows), the runtime strings are exact: macOS
 * paths and Windows arguments are Unicode.
 */
import { Effect } from "effect";

import { PlanFiles } from "./services";

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
 * `/proc/self/cmdline` must decode to its argument, so a word maps to its argument and no other. Undefined when the
 * words do not map and an argument holds a U+FFFD, whose bytes are then unknown; without a U+FFFD, the text of an
 * argument is its bytes.
 */
export const argumentBytes = Effect.fn("plan.argumentBytes")(function* (
  args: ReadonlyArray<string>,
) {
  const files = yield* PlanFiles;
  const commandLine = yield* files.readBytes("/proc/self/cmdline");
  if (commandLine === undefined) return args.map(asBytes);
  // Each word ends with a NUL.
  const words = commandLine.toString("latin1").split("\0").slice(0, -1);
  const tail = args.length === 0 ? [] : words.slice(-args.length);
  const decoded = (word: string): string =>
    Buffer.from(word, "latin1").toString("utf8").replace(REPLACEMENTS, "\uFFFD");
  if (
    tail.length === args.length &&
    tail.every((word, index) => decoded(word) === args[index]?.replace(REPLACEMENTS, "\uFFFD"))
  )
    return tail;
  return args.some((arg) => arg.includes("\uFFFD")) ? undefined : args.map(asBytes);
});

/** The bytes of the working folder of this process. */
export const workingFolderBytes = Effect.fn("plan.workingFolderBytes")(function* () {
  const files = yield* PlanFiles;
  const target = yield* files.linkTarget("/proc/self/cwd");
  return target === undefined ? asBytes(process.cwd()) : target.toString("latin1");
});
