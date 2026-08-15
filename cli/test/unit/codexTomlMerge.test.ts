import { describe, expect, it, vi } from "vitest"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync as nodeSpawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { codexSync } from "../../src/engine-native/codexSync"
import { p } from "../../src/engine-native/exec"
import { syncCodexEffort } from "../../src/engine-native/codexToml"
import type { Ctx } from "../../src/engine-native"
import { DEPENDENCIES } from "../../src/engine-native/deps"
import { makeLogger } from "../../src/engine-native/logger"
import { makePlatform, type EngineServices } from "../../src/engine-native/services"
import { kitHome } from "../../src/kitHome"

function testCtx(root: string, dependencyProbe = vi.fn(() => ({ state: "missing" as const }))): Ctx {
  const home = join(root, "home")
  const platform = makePlatform("darwin")
  const services: EngineServices = {
    logger: makeLogger({
      stderr: () => {},
      progress: () => {},
      stdout: () => {}
    }),
    platform,
    deps: {
      spec: (id) => DEPENDENCIES[id],
      probe: dependencyProbe,
      version: async () => "",
      path: async () => "",
      warnMissing: () => {}
    }
  }
  return {
    repoDir: kitHome(),
    home,
    agentsDir: p(home, ".agents"),
    dryRun: false,
    verbose: false,
    skipBubblewrap: false,
    skipPluginRefresh: false,
    reconcile: false,
    prune: false,
    claudeCompactWindow: "",
    claudePermissive: false,
    claudePlugins: [],
    claudeModel: "",
    claudeEffort: "",
    claudeAdvisor: "",
    codexModel: "",
    codexEffort: "",
    syncConcurrency: 3,
    targetFilterSet: true,
    syncClaude: false,
    syncCodex: true,
    syncAgents: false,
    nextStepTriggers: {
      claudePlugins: false,
      claudeRestart: false,
      codexRestart: false,
      skillsRestart: false
    },
    services
  }
}

function prepareConfig(root: string, content: string): string {
  const home = join(root, "home")
  const config = p(home, ".codex", "config.toml")
  mkdirSync(p(home, ".codex"), { recursive: true })
  writeFileSync(config, content)
  return config
}

function expectTomlToParse(content: string): void {
  const parsed = nodeSpawnSync("bun", ["-e", "Bun.TOML.parse(await Bun.stdin.text())"], {
    input: content,
    encoding: "utf8"
  })
  expect(parsed.status, parsed.stderr).toBe(0)
}

const sotConfig = readFileSync(join(kitHome(), "SoT", ".codex", "config.toml"), "utf8")

describe("Codex TOML merge durability", () => {
  it("normalizes a CRLF config and keeps every managed table defined exactly once", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-crlf-merge-"))
    const config = prepareConfig(root, sotConfig.replace(/\n/g, "\r\n"))

    try {
      await codexSync(testCtx(root))
      const deployed = readFileSync(config, "utf8")

      expect(deployed).not.toContain("\r")
      expect(deployed.match(/^\[/gm)).toHaveLength(8)
      expectTomlToParse(deployed)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("declares and preserves the elevated native Windows sandbox", async () => {
    expect(sotConfig).toMatch(/^\[windows\]\nsandbox = "elevated"$/m)

    const root = mkdtempSync(join(tmpdir(), "codex-windows-merge-"))
    const config = prepareConfig(
      root,
      'model = "user-choice"\n\n[windows]\nsandbox = "unelevated"\n'
    )

    try {
      await codexSync(testCtx(root))
      const deployed = readFileSync(config, "utf8")

      expect(deployed.match(/^\[windows\]$/gm)).toHaveLength(1)
      expect(deployed).toMatch(/^\[windows\]\nsandbox = "elevated"$/m)
      expect(deployed).not.toContain('sandbox = "unelevated"')
      expectTomlToParse(deployed)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([
    ["a commented header", "[tui] # keep this note", "[tui]"],
    ["a whitespace-padded header", "[ tui ]", "[tui]"],
    ["a trailing-space header", "[tui] ", "[tui]"],
    ["a single-quoted plugin key", "[plugins.'docks@docks']", '[plugins."docks@docks"]']
  ])("recognizes %s as the managed table instead of duplicating it", async (_label, userHeader, sotHeader) => {
    const root = mkdtempSync(join(tmpdir(), "codex-header-merge-"))
    const config = prepareConfig(root, sotConfig.replace(sotHeader, userHeader))

    try {
      await codexSync(testCtx(root))
      const deployed = readFileSync(config, "utf8")

      expect(deployed.split("\n").filter((line) => line === sotHeader)).toHaveLength(1)
      expectTomlToParse(deployed)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("fails the sync before plugin work when the deployed marketplace JSON is invalid", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-invalid-marketplace-"))
    const dependencyProbe = vi.fn(() => ({ state: "missing" as const }))
    const home = join(root, "home")
    const marketplace = p(home, ".agents", "plugins", "marketplace.json")
    mkdirSync(p(home, ".agents", "plugins"), { recursive: true })
    writeFileSync(marketplace, "{ invalid")

    try {
      await expect(codexSync(testCtx(root, dependencyProbe))).rejects.toThrow(
        `invalid deployed Codex marketplace JSON: ${marketplace}`
      )
      expect(dependencyProbe).not.toHaveBeenCalled()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("propagates a non-ENOENT Codex config read failure", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-config-read-error-"))
    const config = p(join(root, "home"), ".codex", "config.toml")
    mkdirSync(config, { recursive: true })

    try {
      expect(() => syncCodexEffort(testCtx(root), "high")).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
