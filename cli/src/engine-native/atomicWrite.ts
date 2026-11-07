/**
 * File replacement through a temporary sibling and a rename, so a reader never
 * sees a partial write. Every kit writer that rewrites a user file uses it,
 * because these properties must hold for all of them:
 * - A symlinked target stays a symlink; the file it points to is replaced.
 * - The replaced file keeps its permission bits unless the caller sets them.
 * - Each write uses its own temporary name, so two writers never write into
 *   the same temporary file, and a failed write leaves no temporary file.
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
import { dirname, resolve } from "node:path";

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

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

/** Remove the temporary file of a failed write; a missing file is not an error. */
function removeTemporary(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

export function replaceFile(
  target: string,
  content: string | Uint8Array,
  options: ReplaceFileOptions = {},
): void {
  const file = writeTarget(target);
  const mode = options.mode ?? permissionBits(file);
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    // Flag `wx` creates the file or fails, so this write never uses a file of another writer.
    writeFileSync(temporary, content, mode === undefined ? { flag: "wx" } : { flag: "wx", mode });
  } catch (error) {
    // EEXIST: another writer owns the path, so do not touch it.
    if (errorCode(error) !== "EEXIST") removeTemporary(temporary);
    throw error;
  }
  try {
    // writeFileSync applies `mode` only when it creates the file, and through the umask.
    if (mode !== undefined) chmodSync(temporary, mode);
    renameSync(temporary, file);
  } catch (error) {
    removeTemporary(temporary);
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
