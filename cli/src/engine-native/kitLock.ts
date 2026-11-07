/**
 * Kit locks: an SQLite `BEGIN IMMEDIATE` transaction on a dedicated database
 * file. Only `node:` imports, so that a test child process can load this
 * module alone.
 *
 * - The lock is the RESERVED lock of the transaction. At most one connection,
 *   in any process, holds it.
 * - `BEGIN IMMEDIATE` takes RESERVED with no wait for other readers. With
 *   `BEGIN EXCLUSIVE`, two racers that each hold SHARED can both fail.
 * - The OS releases the lock when the holder process ends for any reason. A
 *   paused holder keeps it.
 * - The database stays in rollback journal mode. Never set WAL on a lock file.
 * - A module-level set keeps each open connection, so that the garbage
 *   collector cannot close a lock that a caller dropped.
 * - Only this module opens a lock file. Each run takes each lock once.
 */
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleepMs } from "node:timers/promises";

/** The default time between two tries. */
const POLL_MS = 50;
/** SQLite primary result code SQLITE_BUSY: another connection holds a conflicting lock. */
const SQLITE_BUSY = 5;

export interface KitLockOptions {
  /** Try until `now()` passes the start plus `waitMs`. 0 tries once, with no sleep. */
  readonly waitMs: number;
  /** The time between two tries. */
  readonly pollMs?: number;
  /** The clock in ms; `Date.now` by default. */
  readonly now?: () => number;
  /** The wait between two tries. */
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * True by default: make the lock directory and set its mode to 0700. False
   * for a lock in a folder that the caller made, so the folder keeps its mode.
   */
  readonly privateDirectory?: boolean;
}

/** A held lock. Give it to `releaseKitLock` exactly once. */
export interface KitLock {
  readonly path: string;
  readonly connection: DatabaseSync;
}

export type KitLockResult =
  | { readonly kind: "acquired"; readonly lock: KitLock }
  | { readonly kind: "held" };

/** The connection of each held lock. The garbage collector cannot close a connection in this set. */
const heldConnections = new Set<DatabaseSync>();

/** True for an SQLite error with the primary result code SQLITE_BUSY. */
function isBusy(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null || !("errcode" in cause)) return false;
  return typeof cause.errcode === "number" && (cause.errcode & 0xff) === SQLITE_BUSY;
}

/** Start the write transaction. False when another connection holds the lock. */
function tryBegin(connection: DatabaseSync): boolean {
  try {
    connection.exec("BEGIN IMMEDIATE");
    return true;
  } catch (cause) {
    if (isBusy(cause)) return false;
    throw cause;
  }
}

/**
 * Take the lock at `path`. Make its directory with mode 0700 when necessary,
 * unless `privateDirectory` is false. Return `held` when another connection,
 * in this process or in another process, keeps the lock past the wait bound.
 */
export async function acquireKitLock(
  path: string,
  options: KitLockOptions,
): Promise<KitLockResult> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => sleepMs(ms));
  const pollMs = options.pollMs ?? POLL_MS;
  const deadline = now() + options.waitMs;

  if (options.privateDirectory !== false) {
    const directory = dirname(path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  const connection = new DatabaseSync(path);
  try {
    // A busy lock must fail at once; this loop does the wait.
    connection.exec("PRAGMA busy_timeout = 0");
    for (;;) {
      if (tryBegin(connection)) {
        heldConnections.add(connection);
        return { kind: "acquired", lock: { path, connection } };
      }
      const remaining = deadline - now();
      if (remaining <= 0) break;
      await sleep(Math.min(pollMs, remaining));
    }
  } catch (cause) {
    connection.close();
    throw cause;
  }
  connection.close();
  return { kind: "held" };
}

/** Release the lock: end the transaction and close the connection. */
export function releaseKitLock(lock: KitLock): void {
  heldConnections.delete(lock.connection);
  try {
    lock.connection.exec("ROLLBACK");
  } finally {
    lock.connection.close();
  }
}
