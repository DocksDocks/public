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
        /^\[dry-run\] ensure Session Relay CLI 0\.15\.0 from DocksDocks\/docks@session-relay--v0\.15\.0 \((?:x86_64-unknown-linux-musl|aarch64-unknown-linux-musl|x86_64-apple-darwin|aarch64-apple-darwin)\) -> ~\/\.local\/bin\/session-relay\n$/
      )
      expect(run.stdout.match(/\n/g)).toHaveLength(1)
    } finally {
      rmSync(run.home, { recursive: true, force: true })
    }
  })

  it("pins the independently verified Relay release and package version", () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "SoT", "toolchain.json"), "utf8"))
    const packageManifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"))

    expect(packageManifest.version).toBe("0.13.0")
    expect(manifest.tools["session-relay"]).toEqual({
      kind: "managed-release",
      policy: "exact",
      verified: "0.15.0",
      repository: "DocksDocks/docks",
      tag: "session-relay--v0.15.0",
      plugin_id: "session-relay@docks",
      plugin_version: "0.15.0",
      install_path: "~/.local/bin/session-relay",
      assets: {
        "x86_64-unknown-linux-musl": "875ca460a21d4f205833db5629bcf249413da77e444f4927107a44e63b71acab",
        "aarch64-unknown-linux-musl": "ee52d7757a22febe3fcb4e00dbb81ec1fb1a1d5769c5eeda903f11a765029a06",
        "x86_64-apple-darwin": "8f4b11be831d5fc232965264c354f202c67c2260f383fba3e8c811eb6ea8ca39",
        "aarch64-apple-darwin": "24ef2cc98a4034391fef60bc3c13a672511b024f0d6493395bb61562936ac5c7"
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
