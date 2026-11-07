/**
 * File replacement through a temporary sibling and a rename, so a reader never
 * sees a partial write. Kit writers that replace a user file through this
 * helper get these properties:
 * - A symlinked target stays a symlink; the file it points to is replaced.
 * - The replaced file keeps its permission bits unless the caller sets them.
 * - Each write uses its own temporary name, so two writers never write into
 *   the same temporary file.
 * - A write that throws tries to remove its temporary file. A failed removal,
 *   or a process that is killed during a write, can leave one.
 */
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** The longest file name that common filesystems accept, in UTF-8 bytes. */
const MAX_NAME_BYTES = 255;

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

/**
 * A temporary sibling name unique to this write: `<file>.<pid>.<16 hex>.tmp`.
 * When that name is longer than the filesystem accepts, use the short
 * `.<16 hex>.tmp` in the same directory.
 */
function temporaryPath(file: string): string {
  const unique = randomBytes(8).toString("hex");
  const long = `${file}.${process.pid}.${unique}.tmp`;
  if (Buffer.byteLength(basename(long)) <= MAX_NAME_BYTES) return long;
  return join(dirname(file), `.${unique}.tmp`);
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
}

/**
 * Replace `path` through `replaceFile` only when its content differs. Returns
 * false when the file already holds `content`, else true.
 */
export function replaceTextIfChanged(path: string, content: string): boolean {
  if (existsSync(path) && readFileSync(path, "utf8") === content) return false;
  replaceFile(path, content);
  return true;
}
