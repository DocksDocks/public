import { rmSync } from "node:fs"
import { afterAll, describe, expect, it } from "vitest"
import { runPublicCli } from "../lib/goldenExecution"
import { cleanupTemporaryDirs, makeStubDir } from "../lib/goldenResources"

afterAll(cleanupTemporaryDirs)

/**
 * Each case spawns the real public CLI, so cold Bun startup dominates the
 * runtime. Vitest's 5s default is exceeded when the whole suite runs in
 * parallel; the work itself takes about 1s.
 */
const SPAWN_TIMEOUT_MS = 30_000

describe("toolchain report", () => {
  it("reports a present tool with an unreadable version as unknown instead of ok", () => {
    const stubs = makeStubDir({
      claude: `if (args[0] === "--version") process.exitCode = 9`
    })
    const run = runPublicCli(["toolchain", "check"], "home-fresh", stubs)

    try {
      expect(run.exitCode).toBe(0)
      const claude = run.stdout.split("\n").find((line) => line.startsWith("claude"))
      expect(claude).toMatch(/^claude\s+check\s+\?\s+2\.1\.219\s+-\s+unknown$/)
      expect(claude).not.toMatch(/\bok$/)
    } finally {
      rmSync(run.home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS)
})

describe("public toolchain ensure", () => {
  it("rejects unknown managed tools at the public boundary", () => {
    const stubs = makeStubDir()
    const run = runPublicCli(["toolchain", "ensure", "definitely-unknown-tool"], "home-fresh", stubs)

    try {
      expect(run.exitCode).toBe(2)
      expect(run.stdout).toBe("")
      expect(run.stderr).toBe(
        "toolchain ensure needs a managed tool: bun\n"
      )
    } finally {
      rmSync(run.home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS)
})
