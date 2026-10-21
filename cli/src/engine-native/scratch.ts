/**
 * Agent temporary directories. `createScratchDir` makes a private directory
 * under the kit scratch root. `removeTemporaryPath` removes a path only when it
 * is strictly inside an allowed root and no other user can change a directory
 * on its path, so a deny-listed `rm -r` is never needed for cleanup and the
 * home directory and `/` can never be the target.
 */
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

import { p } from "./exec";

const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function kitCacheDir(home: string): string {
  return p(home, ".cache", "docks-kit");
}

export function scratchRoot(home: string): string {
  return p(kitCacheDir(home), "scratch");
}

export function createScratchDir(root: string, label: string): string {
  if (!LABEL_PATTERN.test(label)) {
    throw new Error("label must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$");
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  const directory = mkdtempSync(join(root, `${label}-`));
  chmodSync(directory, 0o700);
  return realpathSync(directory);
}

/** True when `child` is `parent` itself or lies below it. */
export function isSameOrInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

/** True when `child` lies strictly below `parent`. */
export function isStrictlyInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

function realpathOrUndefined(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

const STICKY = 0o1000;
const GROUP_OR_OTHER_WRITE = 0o022;

/** The user and root may own a directory on a trusted path. */
function isTrustedOwner(uid: number, user: number): boolean {
  return uid === user || uid === 0;
}

/**
 * The first directory from the filesystem root down to the parent of `path`
 * that another user can change, or `undefined`. The user or root must own each
 * directory, and group and others must not write it, except a sticky directory
 * whose next entry on the path the user or root owns: POSIX lets only that
 * entry's owner, the directory owner, or root rename such an entry.
 */
function untrustedParent(path: string, user: number): string | undefined {
  const chain = [path];
  for (let parent = dirname(path); parent !== chain[0]; parent = dirname(parent)) {
    chain.unshift(parent);
  }
  for (let index = 0; index < chain.length - 1; index++) {
    const directory = lstatSync(chain[index]);
    if (!directory.isDirectory() || !isTrustedOwner(directory.uid, user)) return chain[index];
    if ((directory.mode & GROUP_OR_OTHER_WRITE) === 0) continue;
    const sticky = (directory.mode & STICKY) !== 0;
    if (!sticky || !isTrustedOwner(lstatSync(chain[index + 1]).uid, user)) return chain[index];
  }
  return undefined;
}

/**
 * True when no other user can replace or change `root`: its path is trusted,
 * the user or root owns it, and others cannot write it unless it is sticky.
 * Windows has no POSIX owner bits, so every root passes there.
 */
function isTrustedRoot(root: string): boolean {
  if (process.getuid === undefined) return true;
  const user = process.getuid();
  const stats = lstatSync(root);
  if (!isTrustedOwner(stats.uid, user)) return false;
  if ((stats.mode & GROUP_OR_OTHER_WRITE) !== 0 && (stats.mode & STICKY) === 0) return false;
  return untrustedParent(root, user) === undefined;
}

export function allowedRemovalRoots(input: {
  readonly home: string;
  readonly scratch: string;
  readonly tmp: string;
  readonly platform: NodeJS.Platform;
}): ReadonlyArray<string> {
  const candidates = [input.scratch, input.tmp];
  if (input.platform !== "win32") candidates.push("/tmp", "/var/tmp");
  const home = realpathOrUndefined(input.home) ?? input.home;
  const roots: Array<string> = [];
  for (const candidate of candidates) {
    const root = realpathOrUndefined(candidate);
    if (root === undefined || roots.includes(root)) continue;
    if (dirname(root) === root || isSameOrInside(root, home)) continue;
    if (!isTrustedRoot(root)) continue;
    roots.push(root);
  }
  return roots;
}

export type RemovalOutcome =
  | { readonly kind: "removed"; readonly path: string }
  | { readonly kind: "refused"; readonly path: string; readonly reason: string };

function errorCode(cause: unknown): string | undefined {
  return cause instanceof Error && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : undefined;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Remove `operand` when every check passes, in this order: it exists, it is
 * not a symbolic link (also with trailing separators), its real path is
 * strictly inside one root and is no root itself, it does not contain the home
 * directory, the current user owns it, no other user can change a directory on
 * its path, and it is on the same filesystem as its root. The first failed
 * check refuses and deletes nothing.
 */
export function removeTemporaryPath(
  operand: string,
  roots: ReadonlyArray<string>,
  home: string,
): RemovalOutcome {
  const refuse = (reason: string): RemovalOutcome => ({ kind: "refused", path: operand, reason });
  // `lstat` of `link/` follows the link, so check the entry without trailing separators.
  const trailing = process.platform === "win32" ? /[\\/]+$/ : /\/+$/;
  const entry = operand.replace(trailing, "") || operand;
  try {
    if (lstatSync(entry).isSymbolicLink()) return refuse("is a symbolic link");
  } catch (cause) {
    return errorCode(cause) === "ENOENT" ? refuse("does not exist") : refuse(errorMessage(cause));
  }
  try {
    const target = realpathSync(entry);
    const root = roots.includes(target)
      ? undefined
      : roots.find((candidate) => isStrictlyInside(candidate, target));
    if (root === undefined) {
      return refuse("is outside the scratch root, the system temporary directory, and /var/tmp");
    }
    if (isSameOrInside(target, realpathOrUndefined(home) ?? home)) {
      return refuse("contains the home directory");
    }
    const stats = statSync(target);
    if (process.getuid !== undefined) {
      const user = process.getuid();
      if (stats.uid !== user) return refuse("is owned by another user");
      const parent = untrustedParent(target, user);
      if (parent !== undefined) {
        return refuse(`has a parent directory that another user can change: ${parent}`);
      }
    }
    if (stats.dev !== statSync(root).dev) return refuse("is on another filesystem");
    rmSync(target, { recursive: true, force: false });
    return { kind: "removed", path: target };
  } catch (cause) {
    return refuse(errorMessage(cause));
  }
}
