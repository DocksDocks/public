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
import {
  WORKFLOW_RECORD_PREFIX,
  defaultWorkflowRecord,
  parseWorkflowRecord,
  renderWorkflowRecordLine
} from "../../src/workflowModels"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")
const GENERATOR = join(REPO_DIR, "cli", "scripts", "generate-sot-payload.ts")

function copyGeneratorRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "docks-payload-"))
  cpSync(join(REPO_DIR, "SoT"), join(root, "SoT"), { recursive: true })
  cpSync(join(REPO_DIR, "notification.mp3"), join(root, "notification.mp3"))
  cpSync(join(REPO_DIR, "docks-kit"), join(root, "docks-kit"))
  cpSync(join(REPO_DIR, "package.json"), join(root, "package.json"))
  mkdirSync(join(root, "cli", "src"), { recursive: true })
  cpSync(join(REPO_DIR, "cli", "src", "generated"), join(root, "cli", "src", "generated"), { recursive: true })
  return root
}

function check(root: string) {
  return spawnSync(process.execPath, [GENERATOR, "--check", "--source-root", root], { encoding: "utf8" })
}

describe("generated SoT payload", () => {
  it("carries the Codex high defaults and the bounded global review rules", () => {
    const consent = "For Docks plan reviews, cross-company review is standing-authorized; do not ask for export consent. This never overrides a host or platform security denial."
    const verification = "Use a narrow-to-broad verification ladder: direct acceptance while iterating, focused regressions next, and one full CI at the pre-commit or release boundary. Reuse still-matching evidence; rerun full CI only after a relevant edit invalidates it."
    const codex = payloadText("SoT/.codex/AGENTS.md")
    const claude = payloadText("SoT/.claude/CLAUDE.md")

    const config = payloadText("SoT/.codex/config.toml")
    expect(config).toMatch(/^model_reasoning_effort = "high"$/m)
    expect(config).toMatch(/^plan_mode_reasoning_effort = "high"$/m)
    expect(config).toMatch(/^model_verbosity = "low"$/m)
    expect(config).toMatch(/^model_reasoning_summary = "concise"$/m)
    expect(config).not.toMatch(/^service_tier\s*=/m)
    expect(config).not.toMatch(/^fast_mode\s*=/m)
    expect(codex.split(consent)).toHaveLength(2)
    expect(claude.split(consent)).toHaveLength(2)
    expect(codex.split(verification)).toHaveLength(2)
    expect(claude.split(verification)).toHaveLength(2)
  })

  it("embeds one identical validated default workflow record for Claude and Codex", () => {
    const recordLines = (document: string) => document
      .split("\n")
      .filter((line) => line.startsWith(WORKFLOW_RECORD_PREFIX))
    const claude = recordLines(payloadText("SoT/.claude/CLAUDE.md"))
    const codex = recordLines(payloadText("SoT/.codex/AGENTS.md"))

    expect(claude).toEqual([renderWorkflowRecordLine(defaultWorkflowRecord())])
    expect(codex).toEqual(claude)
    expect(parseWorkflowRecord(JSON.parse(claude[0]!.slice(WORKFLOW_RECORD_PREFIX.length)) as unknown))
      .toEqual(defaultWorkflowRecord())
  })

  it("uses Claude Edit permission matchers for every path-qualified file rule", () => {
    const settings = JSON.parse(payloadText("SoT/.claude/settings.json")) as {
      permissions: { allow: Array<string>; deny: Array<string> }
    }

    expect(settings.permissions.allow).toContain("Edit(./)")
    expect(settings.permissions.allow).not.toContain("Write(./)")
    for (const path of ["**/.env", "**/.env.local", "**/secrets/**"]) {
      expect(settings.permissions.deny).toContain(`Edit(${path})`)
      expect(settings.permissions.deny).not.toContain(`Write(${path})`)
    }
    expect(settings.permissions.deny.some((rule) => rule.startsWith("Write("))).toBe(false)
  })

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

  it("fails --check when package.json version changes", () => {
    const root = copyGeneratorRoot()
    try {
      const path = join(root, "package.json")
      const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
      manifest["version"] = "9.8.7"
      writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
      const result = check(root)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("generated payload is stale: cli/src/generated/sotPayload.ts")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("rejects an invalid package.json version", () => {
    const root = copyGeneratorRoot()
    try {
      const path = join(root, "package.json")
      const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
      manifest["version"] = ""
      writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
      const result = check(root)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("package.json has no valid version")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("reports the root package version from the public CLI", () => {
    const manifest = JSON.parse(readFileSync(join(REPO_DIR, "package.json"), "utf8")) as { version: string }
    const result = spawnSync("bun", [join(REPO_DIR, "cli", "src", "main.ts"), "--version"], {
      encoding: "utf8"
    })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(manifest.version)
  })
})
