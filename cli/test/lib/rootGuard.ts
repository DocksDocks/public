import { readdirSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Repository-root tripwire for the unit suite.
 *
 * Vitest runs with the repository root as the working directory, so any test
 * that builds a path from an undefined variable, or forgets to join its own
 * temporary directory, writes into the checkout instead. Such a file is easy
 * to miss: the run still passes and only a later `git status` shows it.
 *
 * This guard lists the root before and after the run, and fails the run when
 * the suite added an entry. The guard never deletes: parallel agents and
 * editors also write in this checkout, so an added entry is a report, not
 * proof of ownership. Remove the reported entry by hand after you repair the
 * test that wrote it.
 */
const ROOT = resolve(import.meta.dirname, "..", "..", "..")

const listRoot = (): ReadonlyArray<string> => readdirSync(ROOT).sort()

let before: ReadonlyArray<string> = []

export function setup(): void {
  before = listRoot()
}

export function teardown(): void {
  const added = listRoot().filter((entry) => !before.includes(entry))
  if (added.length === 0) return
  const message =
    `The repository root gained ${added.length} entry(s) during the unit run: ${added.join(", ")}.\n` +
    "A test probably wrote to a path relative to the working directory. Build the path from the " +
    "test's own temporary directory, assert the target before you write, then remove the entry."
  // Vitest reports a teardown throw as "error during close" but still exits 0,
  // so set the failing status here. Otherwise the tripwire is decorative.
  process.exitCode = 1
  throw new Error(message)
}
