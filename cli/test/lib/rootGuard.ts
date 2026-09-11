import { spawnSync } from "node:child_process"
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
 * The guard snapshots `git status --porcelain` before and after the run, and
 * fails the run when a porcelain line appeared. A top-level name list missed a
 * nested write such as `SoT/.claude/settings.json`, an edit to a tracked file,
 * and an overwritten golden. The porcelain form reports all three, and it
 * skips `cli/dist-test/` because git already ignores that directory.
 *
 * The guard never deletes: parallel agents and editors also write in this
 * checkout, so an added line is a report, not proof of ownership. Remove the
 * reported path by hand after you repair the test that wrote it.
 */
const ROOT = resolve(import.meta.dirname, "..", "..", "..")

type Snapshot = {
  readonly kind: "porcelain" | "names"
  readonly lines: ReadonlyArray<string>
}

// A checkout without git, and a source tree unpacked from an archive, still
// have to run the suite, so the guard falls back to the top-level name list.
function porcelainLines(): ReadonlyArray<string> | undefined {
  const result = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" })
  if (result.error !== undefined || result.status !== 0) return undefined
  return result.stdout.split("\n").filter((line) => line.length > 0)
}

function takeSnapshot(): Snapshot {
  const lines = porcelainLines()
  if (lines === undefined) return { kind: "names", lines: readdirSync(ROOT).sort() }
  return { kind: "porcelain", lines }
}

let before: Snapshot = { kind: "names", lines: [] }

export function setup(): void {
  before = takeSnapshot()
}

export function teardown(): void {
  const after = takeSnapshot()
  // The two snapshots compare only within one mode, so a git binary that
  // disappeared mid-run produces no report instead of a false one.
  if (after.kind !== before.kind) return
  const added = after.lines.filter((line) => !before.lines.includes(line))
  if (added.length === 0) return
  const subject = after.kind === "porcelain" ? "working tree change(s)" : "root entry(s)"
  const message =
    `The checkout gained ${added.length} ${subject} during the unit run:\n${added.join("\n")}\n` +
    "A test probably wrote to a path relative to the working directory. Build the path from the " +
    "test's own temporary directory, assert the target before you write, then remove the entry."
  // Vitest reports a teardown throw as "error during close" but still exits 0,
  // so set the failing status here. Otherwise the tripwire is decorative.
  process.exitCode = 1
  throw new Error(message)
}
