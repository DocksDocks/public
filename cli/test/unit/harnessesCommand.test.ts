import { existsSync } from "node:fs"
import { afterAll, describe, expect, it } from "vitest"
import {
  harnessStateFile,
  writeHarnessSelection
} from "../../src/engine-native/harnesses"
import { runPublicCli } from "../lib/goldenExecution"
import {
  cleanupTemporaryDirs,
  makeStubDir,
  temporaryDir
} from "../lib/goldenResources"

afterAll(cleanupTemporaryDirs)

const SPAWN_TIMEOUT_MS = 30_000

describe("harnesses command", () => {
  it("reports the legacy default without creating selection state", () => {
    const run = runPublicCli(["harnesses"], "home-fresh", makeStubDir())

    expect(run.exitCode).toBe(0)
    expect(run.stderr).toBe("")
    expect(run.stdout).toContain("Harness selection: claude, codex, agents")
    expect(run.stdout).toContain("no selection is stored yet")
    expect(existsSync(harnessStateFile(run.home))).toBe(false)
  }, SPAWN_TIMEOUT_MS)

  it("reports an omp-only stored selection exactly", () => {
    const home = temporaryDir("harnesses-command-home-")
    writeHarnessSelection(home, ["omp"])

    const run = runPublicCli(
      ["harnesses"],
      "home-fresh",
      makeStubDir(),
      { reuseHome: home }
    )

    expect(run.exitCode).toBe(0)
    expect(run.stderr).toBe("")
    expect(run.stdout).toBe("Harness selection: omp\n")
  }, SPAWN_TIMEOUT_MS)

  it("exits without prompting when output is not a terminal", () => {
    const run = runPublicCli(["harnesses"], "home-fresh", makeStubDir())

    expect(run.exitCode).toBe(0)
    expect(run.stderr).toBe("")
    expect(run.stdout).not.toContain("Choose the harnesses")
  }, SPAWN_TIMEOUT_MS)
})
