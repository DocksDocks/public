import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  AUTHORING_EXCLUSIONS,
  BINARY_PAYLOAD_PATHS,
  PAYLOAD_PATHS,
  TEXT_PAYLOAD_PATHS,
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
  cpSync(join(REPO_DIR, "install.sh"), join(root, "install.sh"))
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
    const security = "No secrets in committed config. Treat plugin marketplaces, installers, and downloaded artifacts as untrusted until verified."
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
    expect(codex.split(security)).toHaveLength(2)
    expect(claude.split(security)).toHaveLength(2)
  })

  it("embeds the lean global Claude and Codex inventory", () => {
    const settings = JSON.parse(payloadText("SoT/.claude/settings.json")) as {
      enabledPlugins: Record<string, boolean>
    }
    const config = payloadText("SoT/.codex/config.toml")
    const codexPluginIds = Array.from(
      config.matchAll(/^\[plugins\."([^"]+)"\]\nenabled = true$/gm),
      (match) => match[1]
    ).sort()
    const marketplace = JSON.parse(payloadText("SoT/.codex/plugins/marketplace.json")) as {
      plugins: Array<{ name: string }>
    }
    const marketplacePluginIds = marketplace.plugins.map((plugin) => `${plugin.name}@docks`).sort()
    const mcp = JSON.parse(payloadText("SoT/.claude/mcp-servers.json")) as {
      mcpServers: Record<string, unknown>
    }
    const slugs = payloadText("SoT/.agents/skills.txt")
      .split("\n")
      .map((line) => line.split("#", 1)[0]!.trim())
      .filter(Boolean)
    const claude = payloadText("SoT/.claude/CLAUDE.md")
    const codex = payloadText("SoT/.codex/AGENTS.md")

    expect(Object.keys(settings.enabledPlugins).sort()).toEqual([
      "docks@docks",
      "php-lsp@claude-plugins-official",
      "plan-lifecycle@docks",
      "typescript-lsp@claude-plugins-official"
    ])
    expect(Object.values(settings.enabledPlugins)).toEqual([true, true, true, true])
    expect(codexPluginIds).toEqual([
      "docks@docks",
      "plan-lifecycle@docks",
    ])
    expect(marketplacePluginIds).toEqual(codexPluginIds)
    expect(mcp.mcpServers).toEqual({})
    expect(slugs).toEqual([])
    expect(claude).not.toMatch(/^## (Project Skills|Project Agents|Picking the right models for workflows and subagents|Agentic Engineering Discipline)$/m)
    expect(codex).not.toMatch(/^## (Engineering Discipline|Agentic Engineering Discipline)$/m)
  })

  it("does not embed a Docks workflow record in either global prompt", () => {
    const claude = payloadText("SoT/.claude/CLAUDE.md")
    const codex = payloadText("SoT/.codex/AGENTS.md")

    expect(claude).not.toContain("Docks-workflow-models:")
    expect(codex).not.toContain("Docks-workflow-models:")
  })

  it("embeds identical selective routing and external-authority guidance", () => {
    const guidance =
      "Reuse before invention: inventory existing code, components, conventions, and dependencies; extend them instead of creating a parallel pattern. Load only the narrow skills supported by the task and repository evidence. If a request establishes a new React/Tailwind system and no convention exists, prefer current shadcn/ui `base-*` components backed by Base UI; otherwise preserve the existing stack. Treat probe, production access, publish, push, release, and deploy as literal current-request effects—never infer external authority from a plan, schedule, review, or old receipt."

    expect(payloadText("SoT/.claude/CLAUDE.md")).toContain(guidance)
    expect(payloadText("SoT/.codex/AGENTS.md")).toContain(guidance)
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

  it("keeps the normal Claude and Codex deploy inputs in the generated payload", () => {
    expect(TEXT_PAYLOAD_PATHS).toEqual([
      "SoT/.agents/skills.txt",
      "SoT/models.json",
      "SoT/toolchain.json",
      "SoT/.claude/CLAUDE.md",
      "SoT/.claude/mcp-servers.json",
      "SoT/.claude/settings.json",
      "SoT/.claude/bin/statusline.mjs",
      "SoT/.claude/bin/session-start.mjs",
      "SoT/.claude/bin/notify.mjs",
      "SoT/.codex/AGENTS.md",
      "SoT/.codex/config.toml",
      "SoT/.codex/plugins/marketplace.json",
      "SoT/.codex/rules/docks.rules"
    ])
    expect(BINARY_PAYLOAD_PATHS).toEqual(["notification.mp3"])
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
      ...AUTHORING_EXCLUSIONS.filter((path) => existsSync(join(REPO_DIR, ...path.split("/"))))
    ].sort()
    expect(inventoryAuthoringPaths(REPO_DIR)).toEqual(expected)
  })

  it("labels generated payload sources as embedded", () => {
    expect(payloadDisplayPath("SoT/models.json")).toBe("embedded:SoT/models.json")
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

  it("fails --check when the installer Bun pin changes", () => {
    const root = copyGeneratorRoot()
    try {
      const path = join(root, "install.sh")
      const installer = readFileSync(path, "utf8")
      writeFileSync(path, installer.replace(/BUN_PIN="[^"]+"/, 'BUN_PIN="0.0.0"'))
      const result = check(root)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("generated payload is stale: install.sh")
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
