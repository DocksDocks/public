/**
 * File replacement through a temporary sibling and a rename, so a reader never
 * sees a partial write. Kit writers that replace a user file through this
 * helper get these properties:
 * - A symlinked target stays a symlink; the file it points to is replaced.
 * - The replaced file keeps its permission bits unless the caller sets them.
 * - Each write uses its own temporary name, so two writers never write into
 *   the same temporary file.
 * - A write that throws tries to remove its temporary file. A failed removal,
 *   or a process that is killed during a write, can leave one. The temporary
 *   name holds the PID of its writer, so the next write of the same target
 *   removes such a file when its writer exited (`removeStaleTemporaries`).
 */
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { processExited } from "./processes";

/** The longest file name that common filesystems accept, in UTF-8 bytes. */
const MAX_NAME_BYTES = 255;

/**
 * A temporary name, parsed from the right: `<target>.<pid>.<16 hex>.tmp`. The
 * PID has no leading zero, so it is 1 or more.
 */
const TEMPORARY_NAME = /^(.+)\.([1-9][0-9]*)\.[0-9a-f]{16}\.tmp$/;
/** The `<target>` part of a short temporary name: `.<tag>`. */
const SHORT_TARGET = /^\.([0-9a-f]{16})$/;

export interface ReplaceFileOptions {
  /**
   * Permission bits for the written file. Without it, an existing file keeps
   * its bits and a new file gets the process umask default.
   */
  readonly mode?: number;
}

/** The file a write must replace: the link target for a symlink, else the path itself. */
function writeTarget(target: string): string {
  let isLink: boolean;
  try {
    isLink = lstatSync(target).isSymbolicLink();
  } catch {
    return target;
  }
  if (!isLink) return target;
  try {
    return realpathSync(target);
  } catch {
    // A dangling link: create the file it names, and keep the link.
    return resolve(dirname(target), readlinkSync(target));
  }
}

function permissionBits(file: string): number | undefined {
  try {
    return statSync(file).mode & 0o777;
  } catch {
    return undefined;
  }
}

/** The tag of a short temporary name: the first 16 hex of sha256(`name`). */
function nameTag(name: string): string {
  return createHash("sha256").update(name).digest("hex").slice(0, 16);
}

/**
 * A temporary sibling name unique to this write: `<file>.<pid>.<16 hex>.tmp`.
 * When that name is longer than the filesystem accepts, use the short
 * `.<tag>.<pid>.<16 hex>.tmp` in the same directory, where `tag` is
 * `nameTag(basename(file))`.
 */
function temporaryPath(file: string): string {
  const unique = randomBytes(8).toString("hex");
  const long = `${file}.${process.pid}.${unique}.tmp`;
  if (Buffer.byteLength(basename(long)) <= MAX_NAME_BYTES) return long;
  return join(dirname(file), `.${nameTag(basename(file))}.${process.pid}.${unique}.tmp`);
}

/**
 * The target that a temporary name records: the base name of the target, or,
 * for a short name, the tag of that base name.
 */
export type TemporaryTarget =
  | { readonly kind: "name"; readonly name: string }
  | { readonly kind: "tag"; readonly tag: string };

interface TemporaryName {
  readonly target: TemporaryTarget;
  readonly pid: number;
}

function parseTemporaryName(entry: string): TemporaryName | undefined {
  const match = TEMPORARY_NAME.exec(entry);
  if (match === null) return undefined;
  const [, target = "", digits = ""] = match;
  const pid = Number(digits);
  if (!Number.isSafeInteger(pid)) return undefined;
  const short = SHORT_TARGET.exec(target);
  return {
    target: short === null ? { kind: "name", name: target } : { kind: "tag", tag: short[1] ?? "" },
    pid,
  };
}

function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Remove each temporary file in `dir` that a killed write left. An entry is
 * removed only when all of these are true:
 * - Its name parses from the right as `<target>.<pid>.<16 hex>.tmp`, or as the
 *   short `.<tag>.<pid>.<16 hex>.tmp`, with a PID of 1 or more.
 * - `owns` accepts its target, so the caller writes that target.
 * - It is a regular file (not a directory or a symlink).
 * - Its PID is not this process, and `processExited` is true for it.
 * This cleanup is best effort: it ignores every error, so it never makes a
 * write fail.
 */
export function removeStaleTemporaries(
  dir: string,
  owns: (target: TemporaryTarget) => boolean,
): void {
  let entries: Array<string>;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const parsed = parseTemporaryName(entry);
    if (parsed === undefined || parsed.pid === process.pid || !owns(parsed.target)) continue;
    const path = join(dir, entry);
    if (!isRegularFile(path) || !processExited(parsed.pid)) continue;
    try {
      unlinkSync(path);
    } catch {
      // Ignore it: the next write of the target tries again.
    }
  }
}

/** Remove the temporary files that killed writes of `file` left. */
function removeStaleTemporariesOf(file: string): void {
  const name = basename(file);
  const tag = nameTag(name);
  removeStaleTemporaries(dirname(file), (target) =>
    target.kind === "name" ? target.name === name : target.tag === tag,
  );
}

function errorSyscall(error: unknown): unknown {
  return typeof error === "object" && error !== null && "syscall" in error
    ? error.syscall
    : undefined;
}

/**
 * Remove the temporary file of a failed write. The caller rethrows the error of
 * the failed write, so a removal error must not replace it.
 */
function removeTemporary(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Ignore it: the error of the failed write tells the user what went wrong.
  }
}

export function replaceFile(
  target: string,
  content: string | Uint8Array,
  options: ReplaceFileOptions = {},
): void {
  const file = writeTarget(target);
  const mode = options.mode ?? permissionBits(file);
  const temporary = temporaryPath(file);
  try {
    // Flag `wx` creates the file or fails, so this write never uses a file of another writer.
    writeFileSync(temporary, content, mode === undefined ? { flag: "wx" } : { flag: "wx", mode });
    // writeFileSync applies `mode` only when it creates the file, and through the umask.
    if (mode !== undefined) chmodSync(temporary, mode);
    renameSync(temporary, file);
  } catch (error) {
    // A failed `open` is the exclusive create. This writer does not own the path,
    // so it touches nothing.
    if (errorSyscall(error) !== "open") removeTemporary(temporary);
    throw error;
  }
  removeStaleTemporariesOf(file);
}

/**
 * Replace `path` through `replaceFile` only when its content differs. Returns
 * false when the file already holds `content`, else true. When it holds
 * `content`, it still removes the temporary files that killed writes of
 * `path` left, because no `replaceFile` call does it.
 */
export function replaceTextIfChanged(path: string, content: string): boolean {
  if (existsSync(path) && readFileSync(path, "utf8") === content) {
    removeStaleTemporariesOf(writeTarget(path));
    return false;
  }
  replaceFile(path, content);
  return true;
}
