import { readFileSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  cleanup,
  cleanupTemporaryDirs,
  makeStubDir,
  materializeVariant,
  readArgvLog,
  runEngine,
  runPublicCli,
  stableStringify
} from "../lib/harness"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")

afterAll(cleanupTemporaryDirs)

function claudeInstalledPlugins(): string {
  const settings = JSON.parse(readFileSync(join(REPO_DIR, "SoT", ".claude", "settings.json"), "utf8")) as {
    enabledPlugins: Record<string, boolean>
  }
  return stableStringify({
    plugins: Object.fromEntries(
      Object.keys(settings.enabledPlugins).map((pluginId) => [pluginId, [{ scope: "user", version: "test" }]])
    )
  })
}

describe.sequential("refresh-only plugin skip", () => {
  it("ensures Session Relay before Claude and Codex plugin work, but never for agents-only", () => {
    const stubs = makeStubDir()
    const tools = runEngine("native", ["sync", "claude", "codex", "--dry-run", "--skip-rtk"], "home-drift", stubs)
    const agents = runEngine("native", ["sync", "agents", "--dry-run", "--skip-rtk"], "home-drift", stubs)
    try {
      expect(tools.exitCode).toBe(0)
      const firstEnsure = tools.stdout.indexOf("[dry-run] ensure Session Relay CLI 0.12.0")
      const claudePlugins = tools.stdout.indexOf("[dry-run] bootstrap + update plugin marketplaces + plugins from SoT")
      const secondEnsure = tools.stdout.indexOf("[dry-run] ensure Session Relay CLI 0.12.0", firstEnsure + 1)
      const codexPlugins = tools.stdout.indexOf("[dry-run] add enabled Codex plugins from SoT")
      expect(firstEnsure).toBeGreaterThanOrEqual(0)
      expect(firstEnsure).toBeLessThan(claudePlugins)
      expect(secondEnsure).toBeGreaterThan(claudePlugins)
      expect(secondEnsure).toBeLessThan(codexPlugins)
      expect(agents.exitCode).toBe(0)
      expect(agents.stdout).not.toContain("Session Relay CLI")
    } finally {
      cleanup([tools, agents])
    }
  })

  it("avoids warmed Claude and Codex refresh calls through both parser layers", () => {
    const variant = materializeVariant("home-drift", {
      ".claude/plugins/installed_plugins.json": claudeInstalledPlugins()
    })
    const stubs = makeStubDir()
    const run = runEngine("native", ["sync", "claude", "codex", "--skip-plugin-refresh"], variant, stubs)
    const publicDryRun = runPublicCli(
      ["sync", "claude", "--dry-run", "--skip-plugin-refresh"],
      "home-drift",
      stubs
    )
    try {
      expect(run.exitCode).toBe(0)
      const argv = readArgvLog(run)
      expect(argv).not.toContain("claude\tplugin marketplace update")
      expect(argv).not.toContain("claude\tplugin update")
      expect(argv).not.toContain("codex\tplugin add")
      expect(argv.match(/^codex\tplugin list --json$/gm)).toHaveLength(1)
      expect(publicDryRun.exitCode).toBe(0)
      expect(publicDryRun.stdout).toContain("skip refresh-only plugin updates")
    } finally {
      cleanup([run])
      rmSync(publicDryRun.home, { recursive: true, force: true })
      rmSync(variant, { recursive: true, force: true })
    }
  })

  it("still installs missing Claude and Codex plugins", () => {
    const codexMissingEffect = `case "$1" in
  --version) echo "codex-cli 0.144.4";;
  plugin) case "$2" in
    list) echo '{"installed":[{"pluginId":"docks@docks","version":"0.12.5","installed":true,"enabled":true},{"pluginId":"session-relay@docks","version":"0.11.0","installed":true,"enabled":true}],"available":[]}' ;;
    add) exit 0;;
  esac;;
esac`
    const run = runEngine(
      "native",
      ["sync", "claude", "codex", "--skip-plugin-refresh"],
      "home-drift",
      makeStubDir({ codex: codexMissingEffect })
    )
    try {
      expect(run.exitCode).toBe(0)
      const argv = readArgvLog(run)
      expect(argv).toContain("claude\tplugin install docks@docks")
      expect(argv.match(/^claude\tplugin update /gm)).toBeNull()
      expect(argv.match(/^codex\tplugin add .+$/gm)).toEqual(["codex\tplugin add effect-kit@docks"])
    } finally {
      cleanup([run])
    }
  })
})
