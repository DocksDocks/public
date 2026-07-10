import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  AUTHORING_EXCLUSIONS,
  PAYLOAD_PATHS,
  inventoryAuthoringPaths
} from "../../scripts/generate-sot-payload"
import { payloadBytes, payloadDisplayPath, payloadPaths, payloadText } from "../../src/payload"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")
const GENERATOR = join(REPO_DIR, "cli", "scripts", "generate-sot-payload.ts")

function copyGeneratorRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "docks-payload-"))
  cpSync(join(REPO_DIR, "SoT"), join(root, "SoT"), { recursive: true })
  cpSync(join(REPO_DIR, "notification.mp3"), join(root, "notification.mp3"))
  cpSync(join(REPO_DIR, "docks-kit"), join(root, "docks-kit"))
  mkdirSync(join(root, "cli", "src"), { recursive: true })
  cpSync(join(REPO_DIR, "cli", "src", "generated"), join(root, "cli", "src", "generated"), { recursive: true })
  return root
}

function check(root: string) {
  return spawnSync(process.execPath, [GENERATOR, "--check", "--source-root", root], { encoding: "utf8" })
}

describe("generated SoT payload", () => {
  it("matches every allowlisted authoring byte in stable order", () => {
    expect(payloadPaths("")).toEqual(PAYLOAD_PATHS)
    for (const path of PAYLOAD_PATHS) {
      expect(payloadBytes(path).equals(readFileSync(join(REPO_DIR, ...path.split("/"))))).toBe(true)
      if (path !== "notification.mp3") {
        expect(payloadText(path)).toBe(readFileSync(join(REPO_DIR, ...path.split("/")), "utf8"))
      }
    }
  })

  it("makes every live SoT file an allowlist or explicit exclusion", () => {
    const expected = [
      ...PAYLOAD_PATHS.filter((path) => path.startsWith("SoT/")),
      ...AUTHORING_EXCLUSIONS
    ].sort()
    expect(inventoryAuthoringPaths(REPO_DIR)).toEqual(expected)
  })

  it("keeps display paths separate from embedded reads", () => {
    expect(payloadDisplayPath("SoT/models.json")).toBe("embedded:SoT/models.json")
    expect(payloadDisplayPath("SoT/models.json", REPO_DIR)).toBe(join(REPO_DIR, "SoT", "models.json"))
    expect(payloadDisplayPath("SoT/models.json", "/kit")).toBe("embedded:SoT/models.json")
  })

  it("fails --check when notification.mp3 changes", () => {
    const root = copyGeneratorRoot()
    try {
      const path = join(root, "notification.mp3")
      writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from([0])]))
      const result = check(root)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("generated payload is stale: cli/src/generated/sotPayload.ts")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("fails --check when the launcher Bun pin changes", () => {
    const root = copyGeneratorRoot()
    try {
      const path = join(root, "docks-kit")
      const launcher = readFileSync(path, "utf8")
      writeFileSync(path, launcher.replace(/BUN_PIN="[^"]+"/, 'BUN_PIN="0.0.0"'))
      const result = check(root)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("generated payload is stale: docks-kit")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
