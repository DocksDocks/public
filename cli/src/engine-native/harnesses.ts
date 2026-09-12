/**
 * Per-machine harness selection at ~/.docks-kit/state.json. The selection keeps
 * the omp harness opt-in. A missing or unreadable state file is represented by
 * undefined so callers resolve it to LEGACY_SELECTION and existing machines
 * keep today's behavior.
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"

import { p } from "./exec"

export type Harness = "claude" | "codex" | "agents" | "omp"

export const HARNESSES: ReadonlyArray<Harness> = ["claude", "codex", "agents", "omp"]
export const LEGACY_SELECTION: ReadonlyArray<Harness> = ["claude", "codex", "agents"]

export interface OmpSessionModel {
  readonly selector: string
  // Session ceiling; absent when the model publishes no ladder, so no
  // invented level ever reaches a selector that omp must resolve.
  readonly thinking?: string
  // Advisor level; absent when the model publishes no ladder.
  readonly advisorThinking?: string
}

export const DEFAULT_OMP_SESSION_MODEL: OmpSessionModel = {
  selector: "opencode-zen/muse-spark-1.3-contributor-free",
  thinking: "xhigh",
  advisorThinking: "medium",
}

function isHarness(value: unknown): value is Harness {
  return value === "claude" || value === "codex" || value === "agents" || value === "omp"
}

function normalizeHarnesses(selection: ReadonlyArray<unknown>): Array<Harness> {
  const selected = new Set<Harness>()
  for (const value of selection) {
    if (isHarness(value)) selected.add(value)
  }
  return HARNESSES.filter((harness) => selected.has(harness))
}

/** Resolve the engine home root from HOME with the platform home as fallback. */
export function engineHome(env: NodeJS.ProcessEnv = process.env): string {
  const home = env["HOME"]
  return home !== undefined && home !== "" ? home : homedir()
}

export function harnessStateFile(home: string): string {
  return p(home, ".docks-kit", "state.json")
}

// Read the whole state record so one key writer keeps sibling keys intact.
// A corrupt file degrades to undefined so callers fall back to defaults.
function readWholeState(home: string): Record<string, unknown> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(harnessStateFile(home), "utf8")) as unknown
  } catch {
    return undefined
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined
  const state = parsed as Record<string, unknown>
  if (state["version"] !== 1) return undefined
  return state
}

// Merge the patch over the stored record so independent keys never erase
// each other when only one writer runs.
function writeWholeState(home: string, patch: Record<string, unknown>): void {
  const existing = readWholeState(home) ?? {}
  const next = { ...existing, ...patch, version: 1 }
  const directory = p(home, ".docks-kit")
  const file = harnessStateFile(home)
  const text = `${JSON.stringify(next, null, 2)}\n`
  // `mode` applies only when mkdir creates the path, so an existing permissive
  // ~/.docks-kit would keep its mode.
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  writeFileSync(file, text, { mode: 0o600 })
  chmodSync(file, 0o600)
}

/** Read valid local state without allowing corruption to make sync unusable. */
export function readHarnessSelection(home: string): ReadonlyArray<Harness> | undefined {
  const state = readWholeState(home)
  if (state === undefined || !Array.isArray(state["harnesses"])) return undefined

  const selection = normalizeHarnesses(state["harnesses"])
  return selection.length > 0 ? selection : undefined
}

export function writeHarnessSelection(home: string, selection: ReadonlyArray<Harness>): void {
  if (selection.length === 0) {
    throw new Error("Cannot write an empty harness selection because sync would become a no-op")
  }

  const harnesses = normalizeHarnesses(selection)
  if (harnesses.length === 0) {
    throw new Error("Harness selection must contain at least one known harness name")
  }

  writeWholeState(home, { harnesses })
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== ""
}

// Read the stored session model without throwing so a corrupt entry falls
// back to the default instead of breaking sync.
export function readOmpSessionModel(home: string): OmpSessionModel | undefined {
  const state = readWholeState(home)
  if (state === undefined) return undefined
  const entry = state["ompSession"]
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return undefined
  const record = entry as Record<string, unknown>
  if (!isNonBlankString(record["selector"])) {
    return undefined
  }
  // Each level stands alone, so a level-free model reads back with no
  // levels while a half-corrupt entry keeps the valid level.
  const model: { selector: string; thinking?: string; advisorThinking?: string } = {
    selector: record["selector"],
  }
  if (isNonBlankString(record["thinking"])) {
    model.thinking = record["thinking"]
  }
  if (isNonBlankString(record["advisorThinking"])) {
    model.advisorThinking = record["advisorThinking"]
  }
  return model
}

export function writeOmpSessionModel(home: string, model: OmpSessionModel): void {
  // A blank selector would make omp resolve an arbitrary model, so reject it
  // before anything reaches disk.
  if (!isNonBlankString(model.selector)) {
    throw new Error("Omp session model selector must be a non-empty string")
  }
  // Persist only non-blank levels so a switch to a level-free model leaves
  // no stale level behind in the stored record.
  const entry: { selector: string; thinking?: string; advisorThinking?: string } = {
    selector: model.selector,
  }
  if (isNonBlankString(model.thinking)) {
    entry.thinking = model.thinking
  }
  if (isNonBlankString(model.advisorThinking)) {
    entry.advisorThinking = model.advisorThinking
  }

  writeWholeState(home, { ompSession: entry })
}
