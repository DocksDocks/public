import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { promptLine } from "../../src/engine-native/toolchain"
import { cleanupTemporaryDirs, makeStubDir, runPublicCli } from "../lib/harness"

afterAll(cleanupTemporaryDirs)

describe("toolchain prompt", () => {
  it("keeps the interactive prompt as raw stderr bytes", () => {
    const input = Buffer.from("n\r\n")
    const chunks: Array<string> = []
    let offset = 0
    const answer = promptLine(
      "Install agent-browser 0.99.0 anyway? [y/N] ",
      (chunk) => chunks.push(chunk),
      (buffer) => {
        if (offset >= input.length) return 0
        buffer[0] = input[offset++]!
        return 1
      }
    )

    expect({ answer, prompt: chunks.join("") }).toEqual({
      answer: "n",
      prompt: "Install agent-browser 0.99.0 anyway? [y/N] "
    })
  })
})

describe("public toolchain ensure", () => {
  it("routes session-relay to the pinned dry-run installer", () => {
    const stubs = makeStubDir()
    const run = runPublicCli(["toolchain", "ensure", "session-relay"], "home-fresh", stubs, {
      env: { DRY_RUN: "1" }
    })

    try {
      expect(run.exitCode).toBe(0)
      expect(run.stderr).toBe("")
      expect(readFileSync(join(run.home, ".golden-argv.log"), "utf8")).toBe("")
      expect(run.stdout).toMatch(
        /^\[dry-run\] ensure Session Relay CLI 0\.13\.0 from DocksDocks\/docks@session-relay--v0\.13\.0 \((?:x86_64-unknown-linux-musl|aarch64-unknown-linux-musl|x86_64-apple-darwin|aarch64-apple-darwin)\) -> ~\/\.local\/bin\/session-relay\n$/
      )
      expect(run.stdout.match(/\n/g)).toHaveLength(1)
    } finally {
      rmSync(run.home, { recursive: true, force: true })
    }
  })

  it("rejects unknown managed tools at the public boundary", () => {
    const stubs = makeStubDir()
    const run = runPublicCli(["toolchain", "ensure", "definitely-unknown-tool"], "home-fresh", stubs)

    try {
      expect(run.exitCode).toBe(2)
      expect(run.stdout).toBe("")
      expect(run.stderr).toBe(
        "toolchain ensure needs a managed tool: rtk, bun, effect-solutions, agent-browser, session-relay\n"
      )
    } finally {
      rmSync(run.home, { recursive: true, force: true })
    }
  })
})
