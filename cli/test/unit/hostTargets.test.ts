import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { HOST_TARGETS } from "../../src/engine-native/os/targets"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")
const ARTIFACT_PATTERN = /\bdocks-kit-(?:linux|darwin|windows)-[a-z0-9-]+(?:\.exe)?\b/g
const PIN_BLOCK_PATTERN = /# BEGIN GENERATED BUN PIN\r?\n([\s\S]*?)\r?\n# END GENERATED BUN PIN/g

function repoFile(path: string): string {
  return readFileSync(resolve(REPO_DIR, path), "utf8")
}

function sorted(values: Iterable<string>): Array<string> {
  return [...values].sort()
}

function mentionedArtifacts(source: string): Array<string> {
  return sorted(new Set(source.match(ARTIFACT_PATTERN) ?? []))
}

function defaultBuildTargets(source: string): Array<string> {
  const assignment = source.match(/\|\|\s*TARGETS=\(([^)]*)\)/)?.[1]
  expect(assignment, "default TARGETS assignment").toBeDefined()
  return assignment?.trim().split(/\s+/) ?? []
}

function generatedPinBody(source: string): string {
  const blocks = [...source.matchAll(PIN_BLOCK_PATTERN)]
  expect(blocks, "generated Bun pin block count").toHaveLength(1)
  return blocks[0]?.[1]?.trim() ?? ""
}

describe("host target script invariants", () => {
  it("keeps derived Bun target and artifact metadata internally consistent", () => {
    for (const target of HOST_TARGETS) {
      expect(target.bunTarget).toBe(`bun-${target.id}`)
      expect(target.artifact.endsWith(".exe")).toBe(target.platform === "windows")
    }
  })

  it("keeps the Bash launcher aligned with every POSIX host target", () => {
    const launcher = repoFile("docks-kit")
    const targets = HOST_TARGETS.filter(({ platform }) => platform !== "windows")

    expect(mentionedArtifacts(launcher)).toEqual(sorted(targets.map(({ artifact }) => artifact)))
    for (const key of targets.flatMap(({ unameKeys }) => unameKeys)) {
      expect(launcher, key).toContain(key)
    }
  })

  it("keeps the PowerShell launcher aligned with every Windows host target", () => {
    const launcher = repoFile("docks-kit.ps1")
    const targets = HOST_TARGETS.filter(({ platform }) => platform === "windows")

    expect(mentionedArtifacts(launcher)).toEqual(sorted(targets.map(({ artifact }) => artifact)))
    for (const architecture of targets.flatMap(({ processorArchitectures }) => processorArchitectures)) {
      expect(launcher, architecture).toContain(architecture)
    }
  })

  it("keeps the compiled binary build aligned with the complete host target table", () => {
    const buildScript = repoFile("cli/build-binaries.sh")

    expect(defaultBuildTargets(buildScript)).toEqual(HOST_TARGETS.map(({ id }) => id))
    expect(buildScript).toContain('name="docks-kit-$target"')
    expect(buildScript).toContain('[[ "$target" == windows-* ]] && name="$name.exe"')
  })


  it("keeps the generated Bun pin synchronized across every launcher and installer", () => {
    const manifest = JSON.parse(repoFile("SoT/toolchain.json")) as {
      tools: { bun: { verified: string } }
    }
    const version = manifest.tools.bun.verified
    const scripts = [
      ["docks-kit", `BUN_PIN="${version}"`],
      ["docks-kit.ps1", `$BunPin = "${version}"`],
      ["install.sh", `BUN_PIN="${version}"`],
      ["install.ps1", `$BunPin = "${version}"`]
    ] as const

    for (const [path, assignment] of scripts) {
      expect(generatedPinBody(repoFile(path)), path).toBe(assignment)
    }
  })
})
