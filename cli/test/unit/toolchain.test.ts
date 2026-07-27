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
        /^\[dry-run\] ensure Session Relay CLI 0\.14\.0 from DocksDocks\/docks@session-relay--v0\.14\.0 \((?:x86_64-unknown-linux-musl|aarch64-unknown-linux-musl|x86_64-apple-darwin|aarch64-apple-darwin)\) -> ~\/\.local\/bin\/session-relay\n$/
      )
      expect(run.stdout.match(/\n/g)).toHaveLength(1)
    } finally {
      rmSync(run.home, { recursive: true, force: true })
    }
  })

  it("pins the independently verified Relay release and package version", () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "SoT", "toolchain.json"), "utf8"))
    const packageManifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"))

    expect(packageManifest.version).toBe("0.12.0")
    expect(manifest.tools["session-relay"]).toEqual({
      kind: "managed-release",
      policy: "exact",
      verified: "0.14.0",
      repository: "DocksDocks/docks",
      tag: "session-relay--v0.14.0",
      plugin_id: "session-relay@docks",
      plugin_version: "0.14.0",
      install_path: "~/.local/bin/session-relay",
      assets: {
        "x86_64-unknown-linux-musl": "140ea11b700b307c07219616ca6e9b3c4fe552916871af54c3bb15712efd4ee3",
        "aarch64-unknown-linux-musl": "726aa5e4f112310a360ab0291600947404d885055844b2041d4f76b5fbeedd30",
        "x86_64-apple-darwin": "5cc8c7d77c5d93f2873841497171efd6ed3c981466625b0370817e094194e4f0",
        "aarch64-apple-darwin": "9256e96d0757f1ffbb2c7ee8aafa1b8bf5de7ee782ab85c30377a5d836ccee87"
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
