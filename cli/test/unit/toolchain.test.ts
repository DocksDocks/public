import { rmSync } from "node:fs"
import { afterAll, describe, expect, it } from "vitest"
import { promptLine } from "../../src/engine-native/toolchain"
import { runPublicCli } from "../lib/goldenExecution"
import { cleanupTemporaryDirs, makeStubDir } from "../lib/goldenResources"

afterAll(cleanupTemporaryDirs)

describe("toolchain prompt", () => {
  it("keeps the interactive prompt as raw stderr bytes", () => {
    const input = Buffer.from("n\r\n")
    const chunks: Array<string> = []
    let offset = 0
    const answer = promptLine(
      "Install effect-solutions 0.99.0 anyway? [y/N] ",
      (chunk) => chunks.push(chunk),
      (buffer) => {
        if (offset >= input.length) return 0
        buffer[0] = input[offset++]!
        return 1
      }
    )

    expect({ answer, prompt: chunks.join("") }).toEqual({
      answer: "n",
      prompt: "Install effect-solutions 0.99.0 anyway? [y/N] "
    })
  })
})

describe("public toolchain ensure", () => {

  it("rejects unknown managed tools at the public boundary", () => {
    const stubs = makeStubDir()
    const run = runPublicCli(["toolchain", "ensure", "definitely-unknown-tool"], "home-fresh", stubs)

    try {
      expect(run.exitCode).toBe(2)
      expect(run.stdout).toBe("")
      expect(run.stderr).toBe(
        "toolchain ensure needs a managed tool: bun, effect-solutions\n"
      )
    } finally {
      rmSync(run.home, { recursive: true, force: true })
    }
  })
})
