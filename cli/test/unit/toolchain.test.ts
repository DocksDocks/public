import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
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
        /^\[dry-run\] ensure Session Relay CLI 0\.16\.0 from DocksDocks\/docks@session-relay--v0\.16\.0 \((?:x86_64-unknown-linux-musl|aarch64-unknown-linux-musl|aarch64-apple-darwin)\) -> ~\/\.local\/bin\/session-relay\n$/
      )
      expect(run.stdout.match(/\n/g)).toHaveLength(1)
    } finally {
      rmSync(run.home, { recursive: true, force: true })
    }
  })

  it("pins the independently verified Relay release", () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "SoT", "toolchain.json"), "utf8"))

    expect(manifest.tools["session-relay"]).toEqual({
      kind: "managed-release",
      policy: "exact",
      verified: "0.16.0",
      repository: "DocksDocks/docks",
      tag: "session-relay--v0.16.0",
      plugin_id: "session-relay@docks",
      plugin_version: "0.16.0",
      install_path: "~/.local/bin/session-relay",
      assets: {
        "x86_64-unknown-linux-musl": "b3ca082dc5ea51e8322be407cdb4bbcaaa05d80bd62c3553f82ab98c1a95498a",
        "aarch64-unknown-linux-musl": "816b6b8bd2d2c2518ea359a5a21502213347b387a1cc576a0fb9cf541e5646ed",
        "aarch64-apple-darwin": "da8b114216c3f2301ad582df8e59b49e91953abcc1112b510466b31637fda825"
      }
    })
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
