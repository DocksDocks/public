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

function sessionRelayEnsureMarker(): string {
  const toolchain = JSON.parse(readFileSync(join(REPO_DIR, "SoT", "toolchain.json"), "utf8")) as {
    tools: { "session-relay": { verified: string } }
  }
  return `[dry-run] ensure Session Relay CLI ${toolchain.tools["session-relay"].verified}`
}

describe.sequential("refresh-only plugin skip", () => {
  it("ensures Session Relay before Claude and Codex plugin work, but never for agents-only", () => {
    const stubs = makeStubDir()
    const tools = runEngine("native", ["sync", "claude", "codex", "--dry-run", "--skip-rtk"], "home-drift", stubs)
    const agents = runEngine("native", ["sync", "agents", "--dry-run", "--skip-rtk"], "home-drift", stubs)
    try {
      expect(tools.exitCode).toBe(0)
      const ensureMarker = sessionRelayEnsureMarker()
      const firstEnsure = tools.stdout.indexOf(ensureMarker)
      const claudePlugins = tools.stdout.indexOf("[dry-run] bootstrap + update plugin marketplaces + plugins from SoT")
      const secondEnsure = tools.stdout.indexOf(ensureMarker, firstEnsure + 1)
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

describe.sequential("project-scoped plugin preservation", () => {
  it("keeps marketplaces used by project-scoped plugins during prune", () => {
    const installed = JSON.parse(claudeInstalledPlugins()) as {
      plugins: Record<string, Array<Record<string, string>>>
    }
    installed.plugins["user-plugin@userplace"] = [{ scope: "user", version: "1.0.0" }]
    installed.plugins["n8n-mcp-skills@n8n-mcp-skills"] = [{
      scope: "project",
      projectPath: "/home/docks/projects/n8n-workflows",
      version: "test"
    }]
    const variant = materializeVariant("home-drift", {
      ".claude/plugins/installed_plugins.json": stableStringify(installed),
      ".claude/plugins/known_marketplaces.json": stableStringify({
        userplace: { source: "user/userplace" },
        "n8n-mcp-skills": { source: "czlonkowski/n8n-skills" }
      })
    })
    const run = runEngine("native", ["sync", "claude", "--prune"], variant, makeStubDir())
    try {
      expect(run.exitCode).toBe(0)
      const argv = readArgvLog(run)
      expect(argv).toContain("claude\tplugin uninstall -y --scope user user-plugin@userplace")
      expect(argv).toContain("claude\tplugin marketplace remove userplace")
      expect(argv).not.toContain("claude\tplugin marketplace remove n8n-mcp-skills")
    } finally {
      cleanup([run])
      rmSync(variant, { recursive: true, force: true })
    }
  })
})
