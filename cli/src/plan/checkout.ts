/**
 * `docks-kit plan base-blob` and `docks-kit plan checkout-state`: the former shell helpers `base-blob.sh` and
 * `checkout-state.sh`, over git, with their output and exit codes. Git output is read as latin1, so each byte of a
 * path or a link target stays one character and is written back as the same byte. git prints its own errors on
 * stderr, as it did under the shell scripts.
 */
import { Effect } from "effect";

import { PlanFiles, PlanProcess, type ProcessOptions, type ProcessResult } from "./services";
import type { FileError, SpawnError } from "./types";

const BASE_BLOB_USAGE = "usage: docks-kit plan base-blob <commit> <path>";
const CHECKOUT_STATE_USAGE = "usage: docks-kit plan checkout-state <checkout>";
// The walk follows at most 40 links, as git and Linux do. This also ends a loop.
const MAX_LINKS = 40;

/** A string of this process (UTF-8 on the command line) as one character per byte. */
const asBytes = (text: string): string => Buffer.from(text, "utf8").toString("latin1");
/** One character per byte back to a string for a command line or a working folder. */
const asText = (bytes: string): string => Buffer.from(bytes, "latin1").toString("utf8");
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

/**
 * `base-blob <commit> <path>`: print the blob id of the file `<path>` in the tree of `<commit>`, as a checkout of
 * `<commit>` would open it, and return 0. The walk reads one path part at a time. A folder link and a file link
 * resolve from the folder that holds the link, and `..` goes to the parent of the real folder that the walk has
 * reached. Exit 1: absent (a missing path, a folder, a submodule, a file with more path parts after it, a link with an
 * empty, absolute, or outside target, or more than 40 links). Exit 2: a git failure or wrong arguments.
 */
export const baseBlob = Effect.fn("plan.baseBlob")(function* (args: ReadonlyArray<string>) {
  if (args.length !== 2 || !args[0]) {
    yield* printError(BASE_BLOB_USAGE);
    return 2;
  }
  const commit = args[0];
  let rest = asBytes(args[1]);
  let dir = "";
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
      if (!dir) return 1;
      const cut = dir.lastIndexOf("/");
      dir = cut >= 0 ? dir.slice(0, cut) : "";
      continue;
    }
    const listed = yield* runGit([
      "--literal-pathspecs",
      "ls-tree",
      "--full-tree",
      commit,
      "--",
      asText(dir ? `${dir}/${part}` : part),
    ]);
    if (!listed.ok) return 2;
    const entry = substituted(listed.result);
    if (!entry) return 1;
    // An entry is `<mode> <type> <object id><tab><path>`. Only the part before the tab is read, and git quotes a
    // path with a newline, so no byte of a name is lost.
    const meta = entry.split("\t")[0];
    const oid = meta.slice(meta.lastIndexOf(" ") + 1);
    switch (meta.split(" ")[0]) {
      case "040000":
        dir = dir ? `${dir}/${part}` : part;
        break;
      case "120000": {
        links += 1;
        if (links > MAX_LINKS) return 1;
        const blob = yield* runGit(["cat-file", "blob", oid]);
        if (!blob.ok) return 2;
        // The trailing newlines of the target are part of its name.
        const target = blob.result.stdout;
        if (target === "" || target.startsWith("/")) return 1;
        rest = rest ? `${target}/${rest}` : target;
        break;
      }
      case "100644":
      case "100755":
        if (rest) return 1;
        yield* Effect.sync(() => {
          process.stdout.write(`${oid}\n`);
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
  const listed = yield* runGit(
    ["-C", asText(topPath), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
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
        // A folder that is not a checkout gives the toplevel of the outer checkout.
        const sub = yield* runGit(["-C", asText(file), "rev-parse", "--show-toplevel"], { env });
        if (!sub.ok) return 2;
        if (substituted(sub.result) !== file) {
          lines.push(`${path}\tspecial`);
          break;
        }
        const head = yield* runGit(["-C", asText(file), "rev-parse", "HEAD"], { env });
        if (!head.ok) return 2;
        lines.push(`${path}\tsubmodule\t${substituted(head.result)}`);
        // The status of the submodule listing is the status of this listing.
        const nested = yield* checkoutListing(asText(file));
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
    const hashed = yield* runGit(
      ["-C", asText(topPath), "hash-object", "--no-filters", "--stdin-paths"],
      { env, input },
    );
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
 * submodule under `<path>/`, `<path>\tmissing`, and `<path>\tspecial`. Exit 1: a path with a tab or a newline, or a
 * link target with a newline. Exit 2: a failed command or wrong arguments. A failure prints nothing on stdout.
 */
export const checkoutState = Effect.fn("plan.checkoutState")(function* (
  args: ReadonlyArray<string>,
) {
  if (args.length !== 1 || !args[0]) {
    yield* printError(CHECKOUT_STATE_USAGE);
    return 2;
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
