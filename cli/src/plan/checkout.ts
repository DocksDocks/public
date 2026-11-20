/**
 * `docks-kit plan base-blob` and `docks-kit plan checkout-state`: the former shell helpers `base-blob.sh` and
 * `checkout-state.sh`, over git, with their output and exit codes. Git output is read as latin1, so each byte of a
 * path or a link target stays one character and is written back as the same byte. A path goes to git as an argument
 * only when its bytes are UTF-8; a byte that is not UTF-8 never passes through a decode. git prints its own errors on
 * stderr, as it did under the shell scripts.
 */
import { Effect } from "effect";

import {
  LOST_BYTE,
  PlanFiles,
  PlanProcess,
  type ProcessOptions,
  type ProcessResult,
  utf8Text,
} from "./services";
import type { FileError, SpawnError } from "./types";

const BASE_BLOB_USAGE = "usage: docks-kit plan base-blob <commit> <path>";
const CHECKOUT_STATE_USAGE = "usage: docks-kit plan checkout-state <checkout>";
const BASE_BLOB_LOST_BYTE = "base-blob: an argument is not UTF-8 text";
const CHECKOUT_STATE_NOT_UTF8 = "checkout-state: a path is not UTF-8 text";
// The walk follows at most 40 links, as git and Linux do. This also ends a loop.
const MAX_LINKS = 40;

/** A string of this process (UTF-8 on the command line) as one character per byte. */
const asBytes = (text: string): string => Buffer.from(text, "utf8").toString("latin1");
/** `$(command)` of a shell: the output without its trailing newlines. */
const substituted = (result: ProcessResult): string => result.stdout.replace(/\n+$/, "");

const printError = (line: string): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stderr.write(`${line}\n`);
  });

/** Run git, with its stderr passed through. A git that could not start prints why. */
const runGit = Effect.fn("plan.runGit")(function* (
  args: ReadonlyArray<string>,
  options: ProcessOptions = {},
) {
  const processes = yield* PlanProcess;
  const result = yield* processes.run("git", args, {
    ...options,
    encoding: "latin1",
    inheritStderr: true,
  });
  if (result.error) yield* printError(`git: ${result.error.message}`);
  return { result, ok: result.error === undefined && result.status === 0 };
});

/** The mode and object id of a tree entry. */
interface TreeEntry {
  readonly mode: string;
  readonly oid: string;
}

/**
 * The entry `name` of the tree `tree` (a commit names its root tree), undefined when the tree has no such entry, or
 * 2 when git fails. `ls-tree -z` prints each name unquoted, as its raw bytes, so the name compares byte for byte, and
 * no path passes to git.
 */
const treeEntry = Effect.fn("plan.treeEntry")(function* (tree: string, name: string) {
  const listed = yield* runGit(["ls-tree", "-z", "--full-tree", tree]);
  if (!listed.ok) return 2 as const;
  // A record is `<mode> <type> <object id><tab><name>`.
  for (const record of listed.result.stdout.split("\0")) {
    const tab = record.indexOf("\t");
    if (tab < 0 || record.slice(tab + 1) !== name) continue;
    const [mode = "", , oid = ""] = record.slice(0, tab).split(" ");
    const entry: TreeEntry = { mode, oid };
    return entry;
  }
  return undefined;
});

/**
 * `base-blob <commit> <path>`: print the blob id of the file `<path>` in the tree of `<commit>`, as a checkout of
 * `<commit>` would open it, and return 0. The walk reads one path part at a time and looks it up in the listing of
 * the tree that it has reached, by object id. A folder link and a file link resolve from the folder that holds the
 * link, and `..` goes to the parent of the real folder that the walk has reached. Exit 1: absent (a missing path, a
 * folder, a submodule, a file with more path parts after it, a link with an empty, absolute, or outside target, or
 * more than 40 links). Exit 2: a git failure, wrong arguments, or an argument with a byte that is not UTF-8, which
 * the command line lost before the walk.
 */
export const baseBlob = Effect.fn("plan.baseBlob")(function* (args: ReadonlyArray<string>) {
  if (args.length !== 2 || !args[0]) {
    yield* printError(BASE_BLOB_USAGE);
    return 2;
  }
  if (args.some((arg) => arg.includes(LOST_BYTE))) {
    yield* printError(BASE_BLOB_LOST_BYTE);
    return 2;
  }
  // The commit, then the object id of each folder that the walk has entered; `..` drops the last one.
  const trees: Array<string> = [args[0]];
  let rest = asBytes(args[1]);
  let links = 0;
  while (rest !== "") {
    let part: string;
    const slash = rest.indexOf("/");
    // A part after a slash stays, so that `file/` and a link to `dir/` keep a part.
    if (slash >= 0) {
      part = rest.slice(0, slash);
      rest = rest.slice(slash + 1) || ".";
    } else {
      part = rest;
      rest = "";
    }
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (trees.length === 1) return 1;
      trees.pop();
      continue;
    }
    const entry = yield* treeEntry(trees[trees.length - 1] ?? args[0], part);
    if (entry === 2) return 2;
    if (entry === undefined) return 1;
    switch (entry.mode) {
      case "040000":
        trees.push(entry.oid);
        break;
      case "120000": {
        links += 1;
        if (links > MAX_LINKS) return 1;
        const blob = yield* runGit(["cat-file", "blob", entry.oid]);
        if (!blob.ok) return 2;
        // The raw bytes of the target; its trailing newlines are part of its name.
        const target = blob.result.stdout;
        if (target === "" || target.startsWith("/")) return 1;
        rest = rest ? `${target}/${rest}` : target;
        break;
      }
      case "100644":
      case "100755":
        if (rest) return 1;
        yield* Effect.sync(() => {
          process.stdout.write(`${entry.oid}\n`);
        });
        return 0;
      default:
        return 1;
    }
  }
  return 1;
});

/** The sorted listing lines of a checkout, or the exit code of a failed listing. */
type Listing = ReadonlyArray<string> | 1 | 2;

/** `"<path>"` as `git hash-object --stdin-paths` reads a C-quoted path, so a quote, backslash, or CR keeps its byte. */
const quotedPath = (path: string): string =>
  `"${path.replace(/[\\"]/g, "\\$&").replace(/\r/g, "\\r")}"`;

/**
 * The listing of the checkout that holds `checkout` (UTF-8 text). git takes a folder on its command line as text, so
 * a toplevel or a folder to ask git about whose bytes are not UTF-8 cannot pass to it: the listing stops with 1.
 */
const checkoutListing: (
  checkout: string,
) => Effect.Effect<Listing, FileError | SpawnError, PlanProcess | PlanFiles> = Effect.fn(
  "plan.checkoutListing",
)(function* (checkout: string) {
  const files = yield* PlanFiles;
  const env = { ...process.env, LC_ALL: "C" };
  const top = yield* runGit(["-C", checkout, "rev-parse", "--show-toplevel"], { env });
  if (!top.ok) return 2;
  const topPath = substituted(top.result);
  const topText = utf8Text(topPath);
  if (topText === undefined) {
    yield* printError(CHECKOUT_STATE_NOT_UTF8);
    return 1;
  }
  const listed = yield* runGit(
    ["-C", topText, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { env },
  );
  if (!listed.ok) return 2;
  if (/[\t\n]/.test(listed.result.stdout)) {
    yield* printError("checkout-state: a path holds a tab or a newline");
    return 1;
  }
  // An untracked repository is listed as `<path>/`. An unmerged path is listed once per stage; one line stays.
  const names = listed.result.stdout.split("\0");
  names.pop();
  const paths = [...new Set(names.map((name) => name.replace(/\/$/, "")))].sort();
  const lines: Array<string> = [];
  const regular: Array<string> = [];
  const executable: Array<string> = [];
  for (const path of paths) {
    const file = `${topPath}/${path}`;
    const entry = yield* files.entry(Buffer.from(file, "latin1"));
    switch (entry.kind) {
      case "link":
        if (entry.target.includes("\n")) {
          yield* printError("checkout-state: a link target holds a newline");
          return 1;
        }
        lines.push(`${path}\tlink\t${entry.target}`);
        break;
      case "file":
        regular.push(path);
        executable.push(entry.executable ? "x" : "");
        break;
      case "directory": {
        const fileText = utf8Text(file);
        if (fileText === undefined) {
          yield* printError(CHECKOUT_STATE_NOT_UTF8);
          return 1;
        }
        // A folder that is not a checkout gives the toplevel of the outer checkout.
        const sub = yield* runGit(["-C", fileText, "rev-parse", "--show-toplevel"], { env });
        if (!sub.ok) return 2;
        if (substituted(sub.result) !== file) {
          lines.push(`${path}\tspecial`);
          break;
        }
        const head = yield* runGit(["-C", fileText, "rev-parse", "HEAD"], { env });
        if (!head.ok) return 2;
        lines.push(`${path}\tsubmodule\t${substituted(head.result)}`);
        // The status of the submodule listing is the status of this listing.
        const nested = yield* checkoutListing(fileText);
        if (nested === 1 || nested === 2) return nested;
        for (const line of nested) lines.push(`${path}/${line}`);
        break;
      }
      case "special":
        lines.push(`${path}\tspecial`);
        break;
      case "missing":
        lines.push(`${path}\tmissing`);
        break;
    }
  }
  if (regular.length > 0) {
    // One hash-object process reads all regular files, with the raw bytes on disk and no filter.
    const input = Buffer.from(regular.map((path) => `${quotedPath(path)}\n`).join(""), "latin1");
    const hashed = yield* runGit(["-C", topText, "hash-object", "--no-filters", "--stdin-paths"], {
      env,
      input,
    });
    if (!hashed.ok) return 2;
    const blobs = hashed.result.stdout.split("\n");
    regular.forEach((path, index) =>
      lines.push(`${path}\t${blobs[index] ?? ""}\t${executable[index]}`.replace(/\t$/, "")),
    );
  }
  // Each character is one byte, so the default order is the byte order of `LC_ALL=C sort`.
  return lines.sort();
});

/**
 * `checkout-state <checkout>`: print the state on disk of each cached or untracked, not ignored path of the checkout
 * that holds `<checkout>`, one sorted line per path, and return 0. Lines: `<path>\t<blob id>[\tx]` for a regular file
 * (raw bytes, `x` when executable), `<path>\tlink\t<target>`, `<path>\tsubmodule\t<head>` followed by the lines of the
 * submodule under `<path>/`, `<path>\tmissing`, and `<path>\tspecial`. Exit 1: a path with a tab or a newline, a
 * link target with a newline, or a checkout, a submodule, or another folder that git must open whose path is not
 * UTF-8 text (also `<checkout>` itself, when the command line lost a byte of it). Exit 2: a failed command or wrong
 * arguments. A failure prints nothing on stdout.
 */
export const checkoutState = Effect.fn("plan.checkoutState")(function* (
  args: ReadonlyArray<string>,
) {
  if (args.length !== 1 || !args[0]) {
    yield* printError(CHECKOUT_STATE_USAGE);
    return 2;
  }
  if (args[0].includes(LOST_BYTE)) {
    yield* printError(CHECKOUT_STATE_NOT_UTF8);
    return 1;
  }
  const listing = yield* checkoutListing(args[0]).pipe(
    Effect.catchTags({
      FileError: (error) => printError(error.message).pipe(Effect.as(2 as const)),
      SpawnError: (error) => printError(error.message).pipe(Effect.as(2 as const)),
    }),
  );
  if (listing === 1 || listing === 2) return listing;
  const output = Buffer.from(listing.map((line) => `${line}\n`).join(""), "latin1");
  yield* Effect.sync(() => {
    process.stdout.write(output);
  });
  return 0;
});
