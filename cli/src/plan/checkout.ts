/**
 * `docks-kit plan base-blob` and `docks-kit plan checkout-state`: the former shell helpers `base-blob.sh` and
 * `checkout-state.sh`, over git, with their output and exit codes. Paths are byte strings (`bytes.ts`): the arguments
 * and git output keep each byte as one character, and each byte is written back as the same byte. git prints its own
 * errors on stderr, as it did under the shell scripts.
 */
import path from "node:path";

import { Effect } from "effect";

import { argumentBytes, utf8Text, workingFolderBytes } from "./bytes";
import { PlanFiles, PlanProcess, type ProcessOptions, type ProcessResult } from "./services";
import type { FileError, SpawnError } from "./types";

const BASE_BLOB_USAGE = "usage: docks-kit plan base-blob <commit> <path>";
const CHECKOUT_STATE_USAGE = "usage: docks-kit plan checkout-state <checkout>";
const BASE_BLOB_LOST_BYTE = "base-blob: the command line lost a byte of an argument";
const CHECKOUT_STATE_LOST_BYTE = "checkout-state: the command line lost a byte of <checkout>";
// The walk follows at most 40 links, as git and Linux do. This also ends a loop.
const MAX_LINKS = 40;
const OBJECT_ID = /^[0-9a-f]{40,64}$/;

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
 * The tree-ish of the root of `<commit>` (a byte string), or undefined when git fails. A commit that is UTF-8 text
 * goes to git as the argument, as under the shell script. Other bytes cannot pass on a command line, so git reads
 * `<commit>^{tree}` from stdin and prints the tree id.
 */
const rootTree = Effect.fn("plan.rootTree")(function* (commit: string) {
  const text = utf8Text(commit);
  if (text !== undefined) return text;
  const resolved = yield* runGit(["cat-file", "--batch-check=%(objectname)"], {
    input: Buffer.from(`${commit}^{tree}\n`, "latin1"),
  });
  if (!resolved.ok) return undefined;
  const line = substituted(resolved.result);
  if (OBJECT_ID.test(line)) return line;
  // git prints `<name> missing` or `<name> ambiguous`, with the bytes of the name.
  yield* Effect.sync(() => {
    process.stderr.write(Buffer.from(`base-blob: ${line}\n`, "latin1"));
  });
  return undefined;
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
 * `<commit>` would open it, and return 0. The arguments are read as bytes. The walk reads one path part at a time and
 * looks it up in the listing of the tree that it has reached, by object id. A folder link and a file link resolve
 * from the folder that holds the link, and `..` goes to the parent of the real folder that the walk has reached.
 * Exit 1: absent (a missing path, a folder, a submodule, a file with more path parts after it, a link with an empty,
 * absolute, or outside target, or more than 40 links). Exit 2: a git failure, wrong arguments, or an argument whose
 * bytes the command line lost.
 */
export const baseBlob = Effect.fn("plan.baseBlob")(function* (args: ReadonlyArray<string>) {
  if (args.length !== 2 || !args[0]) {
    yield* printError(BASE_BLOB_USAGE);
    return 2;
  }
  const bytes = yield* argumentBytes(args);
  if (bytes === undefined) {
    yield* printError(BASE_BLOB_LOST_BYTE);
    return 2;
  }
  const [commit = "", target = ""] = bytes;
  // The root, resolved at the first lookup, then the object id of each folder that the walk has entered; `..` drops
  // the last one.
  let root: string | undefined;
  const trees: Array<string> = [];
  let rest = target;
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
      if (trees.length === 0) return 1;
      trees.pop();
      continue;
    }
    root ??= yield* rootTree(commit);
    if (root === undefined) return 2;
    const entry = yield* treeEntry(trees.at(-1) ?? root, part);
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
        const linkTarget = blob.result.stdout;
        if (linkTarget === "" || linkTarget.startsWith("/")) return 1;
        rest = rest ? `${linkTarget}/${rest}` : linkTarget;
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

/** The links of one checkout-state run: their private scratch folder, made at the first link, and their count. */
interface GitFolders {
  folder: string | undefined;
  links: number;
}

/**
 * A path that git takes on its command line for the folder `bytes`: the folder itself when its bytes are UTF-8,
 * otherwise a link with an ASCII name, in the scratch folder of the run, whose target holds the bytes (from the
 * working folder, when they are relative). git runs in the real folder, so a path that it prints keeps its bytes.
 */
const gitFolder = Effect.fn("plan.gitFolder")(function* (folders: GitFolders, bytes: string) {
  const text = utf8Text(bytes);
  if (text !== undefined) return text;
  const files = yield* PlanFiles;
  const folder = folders.folder ?? (yield* files.scratchFolder("plan-git-folders"));
  folders.folder = folder;
  const link = path.join(folder, String(folders.links));
  folders.links += 1;
  const target = bytes.startsWith("/") ? bytes : `${yield* workingFolderBytes()}/${bytes}`;
  yield* files.symlink(Buffer.from(target, "latin1"), link);
  return link;
});

/** `"<path>"` as `git hash-object --stdin-paths` reads a C-quoted path, so a quote, backslash, or CR keeps its byte. */
const quotedPath = (file: string): string =>
  `"${file.replace(/[\\"]/g, "\\$&").replace(/\r/g, "\\r")}"`;

/** The listing of the checkout that holds the folder `checkout`, a path that git takes (see `gitFolder`). */
const checkoutListing: (
  checkout: string,
  folders: GitFolders,
) => Effect.Effect<Listing, FileError | SpawnError, PlanProcess | PlanFiles> = Effect.fn(
  "plan.checkoutListing",
)(function* (checkout: string, folders: GitFolders) {
  const files = yield* PlanFiles;
  const env = { ...process.env, LC_ALL: "C" };
  const top = yield* runGit(["-C", checkout, "rev-parse", "--show-toplevel"], { env });
  if (!top.ok) return 2;
  const topPath = substituted(top.result);
  const topFolder = yield* gitFolder(folders, topPath);
  const listed = yield* runGit(
    ["-C", topFolder, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
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
  for (const name of paths) {
    const file = `${topPath}/${name}`;
    const entry = yield* files.entry(Buffer.from(file, "latin1"));
    switch (entry.kind) {
      case "link":
        if (entry.target.includes("\n")) {
          yield* printError("checkout-state: a link target holds a newline");
          return 1;
        }
        lines.push(`${name}\tlink\t${entry.target}`);
        break;
      case "file":
        regular.push(name);
        executable.push(entry.executable ? "x" : "");
        break;
      case "directory": {
        const folder = yield* gitFolder(folders, file);
        // A folder that is not a checkout gives the toplevel of the outer checkout.
        const sub = yield* runGit(["-C", folder, "rev-parse", "--show-toplevel"], { env });
        if (!sub.ok) return 2;
        if (substituted(sub.result) !== file) {
          lines.push(`${name}\tspecial`);
          break;
        }
        const head = yield* runGit(["-C", folder, "rev-parse", "HEAD"], { env });
        if (!head.ok) return 2;
        lines.push(`${name}\tsubmodule\t${substituted(head.result)}`);
        // The status of the submodule listing is the status of this listing.
        const nested = yield* checkoutListing(folder, folders);
        if (nested === 1 || nested === 2) return nested;
        for (const line of nested) lines.push(`${name}/${line}`);
        break;
      }
      case "special":
        lines.push(`${name}\tspecial`);
        break;
      case "missing":
        lines.push(`${name}\tmissing`);
        break;
    }
  }
  if (regular.length > 0) {
    // One hash-object process reads all regular files, with the raw bytes on disk and no filter.
    const input = Buffer.from(regular.map((name) => `${quotedPath(name)}\n`).join(""), "latin1");
    const hashed = yield* runGit(
      ["-C", topFolder, "hash-object", "--no-filters", "--stdin-paths"],
      { env, input },
    );
    if (!hashed.ok) return 2;
    const blobs = hashed.result.stdout.split("\n");
    regular.forEach((name, index) =>
      lines.push(`${name}\t${blobs[index] ?? ""}\t${executable[index]}`.replace(/\t$/, "")),
    );
  }
  // Each character is one byte, so the default order is the byte order of `LC_ALL=C sort`.
  return lines.sort();
});

/** The listing of the checkout that holds the argument `checkout`; the links of the run go away at its end. */
const listCheckout = Effect.fn("plan.listCheckout")(function* (checkout: string) {
  const bytes = yield* argumentBytes([checkout]);
  if (bytes === undefined) {
    yield* printError(CHECKOUT_STATE_LOST_BYTE);
    return 1 as const;
  }
  return yield* Effect.acquireUseRelease(
    Effect.sync((): GitFolders => ({ folder: undefined, links: 0 })),
    (folders) =>
      gitFolder(folders, bytes[0] ?? "").pipe(
        Effect.flatMap((folder) => checkoutListing(folder, folders)),
      ),
    ({ folder }) =>
      folder === undefined ? Effect.void : PlanFiles.use((files) => files.removeFolder(folder)),
  );
});

/**
 * `checkout-state <checkout>`: print the state on disk of each cached or untracked, not ignored path of the checkout
 * that holds `<checkout>`, one sorted line per path, and return 0. Lines: `<path>\t<blob id>[\tx]` for a regular file
 * (raw bytes, `x` when executable), `<path>\tlink\t<target>`, `<path>\tsubmodule\t<head>` followed by the lines of the
 * submodule under `<path>/`, `<path>\tmissing`, and `<path>\tspecial`. Paths keep their bytes, also when they are not
 * UTF-8. Exit 1: a path with a tab or a newline, a link target with a newline, or a `<checkout>` whose bytes the
 * command line lost. Exit 2: a failed command or wrong arguments. A failure prints nothing on stdout.
 */
export const checkoutState = Effect.fn("plan.checkoutState")(function* (
  args: ReadonlyArray<string>,
) {
  if (args.length !== 1 || !args[0]) {
    yield* printError(CHECKOUT_STATE_USAGE);
    return 2;
  }
  const listing = yield* listCheckout(args[0]).pipe(
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
