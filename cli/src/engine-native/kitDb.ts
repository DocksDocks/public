/**
 * Per-machine kit store at ~/.docks-kit/kit.db. This module is the only code
 * that opens the database: it applies the schema migrations, imports the
 * legacy ~/.docks-kit/state.json once, and serves the network lookup cache.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { GENERATED_PACKAGE_VERSION } from "../generated/sotPayload";
import { p } from "./exec";

/**
 * Append-only. Never edit or reorder a shipped entry. A release that changes the
 * schema appends one SQL string. State tables (harness_selection, omp_session)
 * get data-preserving migrations; cache_entry may be dropped and recreated
 * because every row can be refetched.
 */
const MIGRATIONS: ReadonlyArray<string> = [
  `CREATE TABLE harness_selection (
  harness TEXT PRIMARY KEY CHECK (harness IN ('claude','codex','agents','omp'))
) STRICT, WITHOUT ROWID;
CREATE TABLE omp_session (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  selector TEXT NOT NULL CHECK (trim(selector) <> ''),
  thinking TEXT CHECK (thinking IS NULL OR trim(thinking) <> ''),
  advisor_thinking TEXT CHECK (advisor_thinking IS NULL OR trim(advisor_thinking) <> '')
) STRICT;
CREATE TABLE cache_entry (
  key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  payload TEXT NOT NULL
) STRICT, WITHOUT ROWID;`,
];

export const KIT_DB_SCHEMA_VERSION: number = MIGRATIONS.length;

export class KitDbTooNewError extends Error {}

export function kitDbFile(home: string): string {
  return p(home, ".docks-kit", "kit.db");
}

function userVersion(db: DatabaseSync): number {
  const version = db.prepare("PRAGMA user_version").get()?.["user_version"];
  return typeof version === "number" ? version : 0;
}

/** Run fn inside BEGIN IMMEDIATE; roll back and rethrow on any error. */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // SQLite already rolled back (for example on SQLITE_FULL); keep the original error.
    }
    throw error;
  }
}

function tooNew(version: number): KitDbTooNewError {
  return new KitDbTooNewError(
    `~/.docks-kit/kit.db uses schema ${version}; this docks-kit knows schema ${KIT_DB_SCHEMA_VERSION}. Upgrade docks-kit (docks-kit update).`,
  );
}

function migrate(db: DatabaseSync): void {
  const current = userVersion(db);
  if (current > KIT_DB_SCHEMA_VERSION) throw tooNew(current);
  if (current === KIT_DB_SCHEMA_VERSION) return;
  inTransaction(db, () => {
    // Another process, possibly a newer kit, can migrate between the first
    // read and the lock; never lower its version.
    const locked = userVersion(db);
    if (locked > KIT_DB_SCHEMA_VERSION) throw tooNew(locked);
    if (locked === KIT_DB_SCHEMA_VERSION) return;
    for (const sql of MIGRATIONS.slice(locked)) db.exec(sql);
    db.exec(`PRAGMA user_version = ${KIT_DB_SCHEMA_VERSION}`);
  });
}

interface LegacyState {
  readonly harnesses: ReadonlyArray<string>;
  readonly session?: { selector: string; thinking: string | null; advisorThinking: string | null };
}

export function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** A blank or non-string value is stored as NULL. */
export function nonBlankOrNull(value: unknown): string | null {
  return isNonBlankString(value) ? value : null;
}

// Same validation the JSON store applied: root object, version 1, non-blank
// selector and levels. Unknown or duplicate harness names are dropped by the
// table's CHECK and PRIMARY KEY through INSERT OR IGNORE.
function parseLegacyState(file: string): LegacyState | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  if (!("version" in parsed) || parsed.version !== 1) return undefined;

  const rawHarnesses = "harnesses" in parsed ? parsed.harnesses : undefined;
  const harnesses = Array.isArray(rawHarnesses)
    ? rawHarnesses.filter((value): value is string => typeof value === "string")
    : [];
  const entry = "ompSession" in parsed ? parsed.ompSession : undefined;
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return { harnesses };
  const selector = nonBlankOrNull("selector" in entry ? entry.selector : undefined);
  if (selector === null) return { harnesses };
  return {
    harnesses,
    session: {
      selector,
      thinking: nonBlankOrNull("thinking" in entry ? entry.thinking : undefined),
      advisorThinking: nonBlankOrNull(
        "advisorThinking" in entry ? entry.advisorThinking : undefined,
      ),
    },
  };
}

function importLegacyState(db: DatabaseSync, legacy: string): void {
  inTransaction(db, () => {
    const rows = db
      .prepare(
        "SELECT (SELECT count(*) FROM harness_selection) + (SELECT count(*) FROM omp_session) AS n",
      )
      .get()?.["n"];
    if (rows !== 0) return;
    const state = parseLegacyState(legacy);
    if (state === undefined) return;
    const insertHarness = db.prepare(
      "INSERT OR IGNORE INTO harness_selection (harness) VALUES (?)",
    );
    for (const harness of state.harnesses) insertHarness.run(harness);
    if (state.session !== undefined) {
      db.prepare(
        "INSERT INTO omp_session (id, selector, thinking, advisor_thinking) VALUES (1, ?, ?, ?)",
      ).run(state.session.selector, state.session.thinking, state.session.advisorThinking);
    }
  });
  // An invalid file is renamed too, so no later run parses it again.
  try {
    renameSync(legacy, `${legacy}.migrated`);
  } catch (error) {
    // A parallel process renamed it first.
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : "";
    if (code !== "ENOENT") throw error;
  }
}

/**
 * Open kit.db, migrate it, import the legacy state file once, and run fn.
 * A read with neither kit.db nor state.json present creates nothing and
 * returns undefined.
 */
export function withKitDb<T>(
  home: string,
  access: "read" | "write",
  fn: (db: DatabaseSync) => T,
): T | undefined {
  const file = kitDbFile(home);
  const legacy = p(home, ".docks-kit", "state.json");
  if (access === "read" && !existsSync(file) && !existsSync(legacy)) return undefined;

  const directory = p(home, ".docks-kit");
  // `mode` applies only when mkdir creates the path, so an existing permissive
  // ~/.docks-kit would keep its mode.
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);

  const db = new DatabaseSync(file);
  try {
    // SQLite gives the -wal and -shm files the mode of the main file.
    if (process.platform !== "win32") chmodSync(file, 0o600);
    // busy_timeout first: the switch to WAL needs a lock.
    db.exec(
      "PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;",
    );
    migrate(db);
    const importing = existsSync(legacy);
    if (importing) importLegacyState(db, legacy);
    const result = fn(db);
    // Fold the WAL into kit.db so a copy of kit.db alone holds every row.
    if (access === "write" || importing) db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return result;
  } finally {
    db.close();
  }
}

// A new kit release refetches every cached row.
const CACHE_FINGERPRINT = GENERATED_PACKAGE_VERSION;

/** Return a fresh cached payload; every failure is a miss. */
export function readCache(
  home: string,
  key: string,
  maxAgeMs: number,
  now: number,
): string | undefined {
  try {
    return withKitDb(home, "read", (db) => {
      const row = db
        .prepare("SELECT fingerprint, fetched_at, payload FROM cache_entry WHERE key = ?")
        .get(key);
      const fetchedAt = row?.["fetched_at"];
      const payload = row?.["payload"];
      if (row?.["fingerprint"] !== CACHE_FINGERPRINT) return undefined;
      if (typeof fetchedAt !== "number" || typeof payload !== "string") return undefined;
      return now - fetchedAt <= maxAgeMs ? payload : undefined;
    });
  } catch {
    return undefined;
  }
}

/** Store a successful lookup; a failed write does nothing. */
export function writeCache(home: string, key: string, payload: string, now: number): void {
  try {
    withKitDb(home, "write", (db) =>
      inTransaction(db, () => {
        db.prepare("DELETE FROM cache_entry WHERE fingerprint <> ?").run(CACHE_FINGERPRINT);
        db.prepare(
          `INSERT INTO cache_entry (key, fingerprint, fetched_at, payload) VALUES (?, ?, ?, ?)
ON CONFLICT(key) DO UPDATE SET fingerprint = excluded.fingerprint, fetched_at = excluded.fetched_at, payload = excluded.payload`,
        ).run(key, CACHE_FINGERPRINT, now, payload);
      }),
    );
  } catch {
    // The cache is an optimization; the next run fetches again.
  }
}
