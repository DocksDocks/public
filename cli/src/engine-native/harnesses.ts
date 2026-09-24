/**
 * Per-machine harness selection and omp session model, stored in ~/.docks-kit/kit.db (kitDb.ts).
 * The selection keeps the omp harness opt-in. A missing or unreadable store is
 * represented by undefined so callers resolve it to LEGACY_SELECTION.
 */
import { homedir } from "node:os";

import { inTransaction, withKitDb } from "./kitDb";
import type { OmpSessionModel } from "./sharedTypes";

export type Harness = "claude" | "codex" | "agents" | "omp";

export const HARNESSES: ReadonlyArray<Harness> = ["claude", "codex", "agents", "omp"];
export const LEGACY_SELECTION: ReadonlyArray<Harness> = ["claude", "codex", "agents"];

export type { OmpSessionModel };

export const DEFAULT_OMP_SESSION_MODEL: OmpSessionModel = {
  selector: "opencode-zen/muse-spark-1.3-contributor-free",
  thinking: "xhigh",
  advisorThinking: "medium",
};

function isHarness(value: unknown): value is Harness {
  return value === "claude" || value === "codex" || value === "agents" || value === "omp";
}

function normalizeHarnesses(selection: ReadonlyArray<unknown>): Array<Harness> {
  const selected = new Set<Harness>();
  for (const value of selection) {
    if (isHarness(value)) selected.add(value);
  }
  return HARNESSES.filter((harness) => selected.has(harness));
}

/** Resolve the engine home root from HOME with the platform home as fallback. */
export function engineHome(env: NodeJS.ProcessEnv = process.env): string {
  const home = env["HOME"];
  return home !== undefined && home !== "" ? home : homedir();
}

/** Read the stored selection; corruption, a too-new schema, or I/O errors yield undefined. */
export function readHarnessSelection(home: string): ReadonlyArray<Harness> | undefined {
  try {
    const selection = withKitDb(home, "read", (db) =>
      normalizeHarnesses(
        db
          .prepare("SELECT harness FROM harness_selection")
          .all()
          .map((row) => row["harness"]),
      ),
    );
    return selection !== undefined && selection.length > 0 ? selection : undefined;
  } catch {
    return undefined;
  }
}

export function writeHarnessSelection(home: string, selection: ReadonlyArray<Harness>): void {
  if (selection.length === 0) {
    throw new Error("Cannot write an empty harness selection because sync would become a no-op");
  }

  const harnesses = normalizeHarnesses(selection);
  if (harnesses.length === 0) {
    throw new Error("Harness selection must contain at least one known harness name");
  }

  withKitDb(home, "write", (db) =>
    inTransaction(db, () => {
      db.exec("DELETE FROM harness_selection");
      const insert = db.prepare("INSERT INTO harness_selection (harness) VALUES (?)");
      for (const harness of harnesses) insert.run(harness);
    }),
  );
}

export function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

// Read the stored session model without throwing so a corrupt store falls
// back to the default instead of breaking sync.
export function readOmpSessionModel(home: string): OmpSessionModel | undefined {
  try {
    return withKitDb(home, "read", (db) => {
      const row = db
        .prepare("SELECT selector, thinking, advisor_thinking FROM omp_session WHERE id = 1")
        .get();
      const selector = row?.["selector"];
      if (!isNonBlankString(selector)) return undefined;
      const thinking = row?.["thinking"];
      const advisorThinking = row?.["advisor_thinking"];
      const model: OmpSessionModel = {
        selector,
        ...(isNonBlankString(thinking) ? { thinking } : {}),
        ...(isNonBlankString(advisorThinking) ? { advisorThinking } : {}),
      };
      return model;
    });
  } catch {
    return undefined;
  }
}

export function writeOmpSessionModel(home: string, model: OmpSessionModel): void {
  // A blank selector would make omp resolve an arbitrary model, so reject it
  // before anything reaches disk.
  if (!isNonBlankString(model.selector)) {
    throw new Error("Omp session model selector must be a non-empty string");
  }
  // Store blank or absent levels as NULL so a switch to a level-free model
  // leaves no stale level behind.
  const thinking = isNonBlankString(model.thinking) ? model.thinking : null;
  const advisorThinking = isNonBlankString(model.advisorThinking) ? model.advisorThinking : null;
  withKitDb(home, "write", (db) =>
    db
      .prepare(
        `INSERT INTO omp_session (id, selector, thinking, advisor_thinking) VALUES (1, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET selector = excluded.selector, thinking = excluded.thinking, advisor_thinking = excluded.advisor_thinking`,
      )
      .run(model.selector, thinking, advisorThinking),
  );
}
