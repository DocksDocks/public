/**
 * File replacement through a temporary sibling and a rename, so a reader never
 * sees a partial write. Every kit writer that rewrites a user file uses it,
 * because two properties must hold for all of them:
 * - A symlinked target stays a symlink; the file it points to is replaced.
 * - The replaced file keeps its permission bits unless the caller sets them.
 */
import {
  chmodSync,
  lstatSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
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

export function replaceFile(
  target: string,
  content: string | Uint8Array,
  options: ReplaceFileOptions = {},
): void {
  const file = writeTarget(target);
  const mode = options.mode ?? permissionBits(file);
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, content, mode === undefined ? {} : { mode });
  // writeFileSync applies `mode` only when it creates the file, and through the umask.
  if (mode !== undefined) chmodSync(temporary, mode);
  renameSync(temporary, file);
}
