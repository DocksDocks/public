/**
 * The `docks-kit tidy --apply` lock. Only `node:` imports, so that a test child
 * process can load this module alone.
 *
 * - The lock holds `<pid> <ISO time> <token>`, written with `wx`.
 * - A lock is stale when its mtime is older than 1 h or its PID is dead.
 * - Stale takeover runs only under the takeover mutex `<lock>.takeover`, and
 *   the holder checks staleness again before it removes the lock. Thus two
 *   runs never both remove a stale lock and both create a new one.
 * - A run removes the lock and the mutex only while they still hold its token.
 * - On Windows, another process can delete or hold the lock or the mutex while
 *   a run reads or removes it. Such a path counts as absent, and only the
 *   exclusive create decides the result.
 */
import { randomBytes } from "node:crypto";
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
  type Stats,
} from "node:fs";

export const LOCK_STALE_MS = 3_600_000;
/** A takeover mutex lives for microseconds; one older than this belongs to a dead run. */
export const TAKEOVER_STALE_MS = 60_000;

export interface TidyLock {
  readonly path: string;
  readonly token: string;
}

function errorCode(cause: unknown): string | undefined {
  return cause instanceof Error && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : undefined;
}

/**
 * Windows keeps a deleted file "delete pending" while a handle to it is open,
 * and refuses a new open of that name with ERROR_ACCESS_DENIED. A delete of a
 * file that another process holds without delete sharing fails with
 * ERROR_SHARING_VIOLATION. libuv, which runs the `node:fs` calls of Bun and
 * Node.js on Windows, reports these errors as EPERM and EBUSY.
 */
const WINDOWS_CONTENTION: Record<string, true> = { EBUSY: true, EPERM: true };

/** True on Windows for an error that another process causes when it deletes or holds the path. */
function isWindowsContention(cause: unknown): boolean {
  const code = errorCode(cause);
  return process.platform === "win32" && code !== undefined && WINDOWS_CONTENTION[code] === true;
}

/**
 * Create `path` with `wx` and write `text`. False when the path exists or, on
 * Windows, when another process deletes it now.
 */
function createExclusive(path: string, text: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (cause) {
    if (errorCode(cause) === "EEXIST" || isWindowsContention(cause)) return false;
    throw cause;
  }
  try {
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
  return true;
}

/** `lstat`; `undefined` when absent or, on Windows, when another process deletes it. */
function lstatIfPresent(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (cause) {
    const code = errorCode(cause);
    if (code === "ENOENT" || code === "ENOTDIR" || isWindowsContention(cause)) return undefined;
    throw cause;
  }
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Remove `path`. Ignore a path that is absent or, on Windows, a path that
 * another process deletes or holds.
 */
function unlinkIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (cause) {
    if (errorCode(cause) !== "ENOENT" && !isWindowsContention(cause)) throw cause;
  }
}

/** Remove `path` only while its third field is still `token`. */
function releaseOwned(path: string, token: string): void {
  if (readText(path)?.trim().split(/\s+/)[2] !== token) return;
  try {
    unlinkSync(path);
  } catch {
    // The path is already gone.
  }
}

/** True when the lock is absent, older than 1 h, or names a dead PID. */
function lockIsStale(path: string, now: number): boolean {
  const stats = lstatIfPresent(path);
  if (stats === undefined) return true;
  if (now - stats.mtimeMs > LOCK_STALE_MS) return true;
  const pid = Number.parseInt(readText(path)?.trim().split(/\s+/)[0] ?? "", 10);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (cause) {
    return errorCode(cause) === "ESRCH";
  }
}

/** Take the takeover mutex; remove a mutex older than 60 s once, then try once more. */
function acquireMutex(mutex: string, text: string, now: number): boolean {
  if (createExclusive(mutex, text)) return true;
  const seen = readText(mutex);
  const stats = lstatIfPresent(mutex);
  if (stats !== undefined && now - stats.mtimeMs <= TAKEOVER_STALE_MS) return false;
  // Remove the stale mutex only while it still holds the text that this run saw.
  if (stats !== undefined && readText(mutex) === seen) unlinkIfPresent(mutex);
  return createExclusive(mutex, text);
}

/** Take the lock, or `undefined` when another run holds it. */
export function acquireTidyLock(path: string, now: number): TidyLock | undefined {
  const token = randomBytes(16).toString("hex");
  const text = `${process.pid} ${new Date(now).toISOString()} ${token}\n`;
  if (createExclusive(path, text)) return { path, token };
  if (!lockIsStale(path, now)) return undefined;
  const mutex = `${path}.takeover`;
  if (!acquireMutex(mutex, text, now)) return undefined;
  try {
    // Another run may have taken the lock over between the first check and the mutex.
    if (!lockIsStale(path, now)) return undefined;
    unlinkIfPresent(path);
    return createExclusive(path, text) ? { path, token } : undefined;
  } finally {
    releaseOwned(mutex, token);
  }
}

export function releaseTidyLock(lock: TidyLock): void {
  releaseOwned(lock.path, lock.token);
}
