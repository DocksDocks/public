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

/** Read valid local state without allowing corruption to make sync unusable. */
export function readHarnessSelection(home: string): ReadonlyArray<Harness> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(harnessStateFile(home), "utf8")) as unknown
  } catch {
    return undefined
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined
  const state = parsed as Record<string, unknown>
  if (state["version"] !== 1 || !Array.isArray(state["harnesses"])) return undefined

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

  const directory = p(home, ".docks-kit")
  const file = harnessStateFile(home)
  const text = `${JSON.stringify({ version: 1, harnesses }, null, 2)}\n`
  // `mode` applies only when mkdir creates the path, so an existing permissive
  // ~/.docks-kit would keep its mode.
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  writeFileSync(file, text, { mode: 0o600 })
  chmodSync(file, 0o600)
}
