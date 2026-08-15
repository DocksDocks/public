import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"

import { mergeSettings } from "../../src/engine-native/settings"
import { kitHome } from "../../src/kitHome"
import { cleanup, readArgvLog, runEngine, runPublicCli } from "../lib/goldenExecution"
import { cleanupTemporaryDirs, makeStubDir, materializeVariant } from "../lib/goldenResources"
import { stableStringify } from "../lib/goldenSnapshot"

afterAll(cleanupTemporaryDirs)

type PermissionListName = "allow" | "deny" | "ask"

interface ClaudeSotSettings {
  readonly permissions: Record<PermissionListName, ReadonlyArray<string>>
  readonly hooks: {
    readonly PostToolUseFailure: ReadonlyArray<{ readonly matcher?: string }>
  }
}

const claudeSotSettings = JSON.parse(
  readFileSync(join(kitHome(), "SoT", ".claude", "settings.json"), "utf8")
) as ClaudeSotSettings

function removeRunAndVariant(home: string, variant: string): void {
  rmSync(home, { recursive: true, force: true })
  rmSync(variant, { recursive: true, force: true })
}

describe.sequential("Claude settings truth", () => {
  it("mirrors every Bash permission rule for PowerShell without broadening allow or ask", () => {
    for (const listName of ["allow", "deny", "ask"] as const) {
      const rules = claudeSotSettings.permissions[listName]
      const bashRules = rules.filter((rule) => rule.startsWith("Bash("))
      const powerShellRules = rules.filter((rule) => rule.startsWith("PowerShell("))
      const mirrors = bashRules.map(
        (rule) => `PowerShell(${rule.slice("Bash(".length, -1)})`
      )

      expect(powerShellRules).toEqual(expect.arrayContaining(mirrors))
      expect(Math.max(...bashRules.map((rule) => rules.indexOf(rule)))).toBeLessThan(
        Math.min(...powerShellRules.map((rule) => rules.indexOf(rule)))
      )
      if (listName !== "deny") expect(powerShellRules).toEqual(mirrors)
    }
  })

  it("denies PowerShell-native destructive command forms", () => {
    const deny = claudeSotSettings.permissions.deny
    const recursiveForceDeletes = ["Remove-Item", "ri", "del", "erase", "rd", "rmdir"].flatMap(
      (command) =>
        ["/", "~", "$env:USERPROFILE"].flatMap((target) => [
          `PowerShell(${command} *-Recurse*-Force* ${target}*)`,
          `PowerShell(${command} *-Force*-Recurse* ${target}*)`
        ])
    )

    expect(deny).toEqual(
      expect.arrayContaining([
        ...recursiveForceDeletes,
        "PowerShell(sudo *)",
        "PowerShell(Start-Process *-Verb RunAs*)",
        "PowerShell(Invoke-Expression *)",
        "PowerShell(iex *)",
        "PowerShell(Format-Volume *)",
        "PowerShell(icacls */grant*Everyone:F*)",
        "PowerShell(icacls */grant*Everyone:(F)*)"
      ])
    )
  })

  it("runs the shell failure hook for Bash and PowerShell", () => {
    expect(claudeSotSettings.hooks.PostToolUseFailure).toEqual(
      expect.arrayContaining([expect.objectContaining({ matcher: "Bash|PowerShell" })])
    )
  })

  it.each([
    ["null", "null"],
    ["array", "[]"],
    ["string", '"s"']
  ])("model rejects a deployed %s document without changing its bytes", (_name, bytes) => {
    const variant = materializeVariant("home-fresh", {
      ".claude/settings.json": bytes
    })
    const run = runPublicCli(["model", "claude", "opus"], variant, makeStubDir())
    try {
      expect(run.exitCode).toBe(1)
      expect(readFileSync(join(run.home, ".claude", "settings.json"), "utf8")).toBe(bytes)
      expect(`${run.stdout}${run.stderr}`).toContain(
        "(--claude-model) <HOME>/.claude/settings.json must contain a JSON object — aborting"
      )
      expect(`${run.stdout}${run.stderr}`).not.toContain("— skipped")
      expect(`${run.stdout}${run.stderr}`).not.toContain("deployed settings model set to opus")
    } finally {
      removeRunAndVariant(run.home, variant)
    }
  })

  it("dry-run rejects non-object deployed settings before promising a merge", () => {
    const bytes = "null"
    const variant = materializeVariant("home-fresh", {
      ".claude/settings.json": bytes
    })
    const run = runEngine(["sync", "claude", "--dry-run"], variant, makeStubDir())
    try {
      expect(run.exitCode).toBe(1)
      expect(readFileSync(join(run.home, ".claude", "settings.json"), "utf8")).toBe(bytes)
      expect(run.output).toContain(
        "Aborting sync: <HOME>/.claude/settings.json must contain a JSON object. Fix it manually or delete it to reinstall."
      )
      expect(run.output).not.toContain("[dry-run] merge")
    } finally {
      cleanup([run])
      rmSync(variant, { recursive: true, force: true })
    }
  })

  it("dry-run previews a modifier the sync would apply to the file it installs", () => {
    const variant = materializeVariant("home-fresh", {})
    const run = runEngine(["sync", "claude", "--dry-run", "--claude-model=opus"], variant, makeStubDir())
    try {
      expect(run.exitCode).toBe(0)
      expect(run.output).toContain("[dry-run] install")
      expect(run.output).toContain("[dry-run] (--claude-model) set .model=opus")
      expect(run.output).not.toContain("missing — skipped")
    } finally {
      cleanup([run])
      rmSync(variant, { recursive: true, force: true })
    }
  })

  it("model reports the skip when no run installs the settings file", () => {
    const variant = materializeVariant("home-fresh", {})
    const run = runPublicCli(["model", "claude", "opus"], variant, makeStubDir())
    try {
      expect(`${run.stdout}${run.stderr}`).toContain("missing — skipped")
      expect(`${run.stdout}${run.stderr}`).not.toContain("[dry-run]")
    } finally {
      removeRunAndVariant(run.home, variant)
    }
  })

  it("rejects a non-object Claude state document without replacing it", () => {
    const bytes = "[]"
    const variant = materializeVariant("home-fresh", {
      ".claude/settings.json": "{}\n",
      ".claude.json": bytes
    })
    const run = runEngine(["sync", "claude"], variant, makeStubDir())
    try {
      expect(run.exitCode).toBe(0)
      expect(readFileSync(join(run.home, ".claude.json"), "utf8")).toBe(bytes)
      expect(run.output).toContain("root must be a JSON object")
      expect(run.output).not.toContain("~/.claude.json updated")
    } finally {
      cleanup([run])
      rmSync(variant, { recursive: true, force: true })
    }
  })

  it("prune keeps an explicitly requested optional plugin and its marketplace", () => {
    const pluginId = "n8n-mcp-skills@n8n-mcp-skills"
    const marketplace = "n8n-mcp-skills"
    const variant = materializeVariant("home-drift", {
      ".claude/plugins/installed_plugins.json": stableStringify({
        plugins: {
          [pluginId]: [{ scope: "user", version: "test" }]
        }
      }),
      ".claude/plugins/known_marketplaces.json": stableStringify({
        [marketplace]: { source: "czlonkowski/n8n-skills" }
      })
    })
    const run = runEngine(
      ["sync", "claude", "--prune", "--claude-plugin=n8n"],
      variant,
      makeStubDir()
    )
    try {
      expect(run.exitCode).toBe(0)
      const argv = readArgvLog(run)
      expect(argv).not.toContain(`claude\tplugin uninstall -y --scope user ${pluginId}`)
      expect(argv).not.toContain(`claude\tplugin marketplace remove ${marketplace}`)
    } finally {
      cleanup([run])
      rmSync(variant, { recursive: true, force: true })
    }
  })

  it("surfaces non-missing settings read failures with a failing status", () => {
    const variant = materializeVariant("home-fresh", {
      ".claude/settings.json": null
    })
    mkdirSync(join(variant, ".claude", "settings.json"), { recursive: true })
    const run = runPublicCli(["model", "claude", "opus"], variant, makeStubDir())
    try {
      expect(run.exitCode).toBe(1)
      expect(`${run.stdout}${run.stderr}`).toContain("EISDIR")
      expect(`${run.stdout}${run.stderr}`).not.toContain("missing — skipped")
    } finally {
      removeRunAndVariant(run.home, variant)
    }
  })

  it("does not mutate repo settings when user input is non-object", () => {
    const repo = { model: "opus", permissions: { allow: ["Read"] } }
    const before = structuredClone(repo)
    const merged = mergeSettings(repo, null)

    expect(repo).toEqual(before)
    expect(merged).not.toBe(repo)
  })
})

describe.sequential("Codex settings truth", () => {
  it("model dry-run skips an absent config while sync still previews the model", () => {
    const variant = materializeVariant("home-fresh", {})
    const modelRun = runPublicCli(["model", "codex", "gpt-5.6-sol", "--dry-run"], variant, makeStubDir())
    const syncRun = runEngine(
      ["sync", "codex", "--dry-run", "--codex-model=gpt-5.6-sol"],
      variant,
      makeStubDir()
    )
    try {
      const modelOutput = `${modelRun.stdout}${modelRun.stderr}`
      expect(modelRun.exitCode).toBe(0)
      expect(modelOutput).toContain("missing — skipped")
      expect(modelOutput).not.toContain("[dry-run] (--codex-model) set model")

      expect(syncRun.exitCode).toBe(0)
      expect(syncRun.output).toContain(
        '[dry-run] (--codex-model) set model = "gpt-5.6-sol" in <HOME>/.codex/config.toml'
      )
      expect(syncRun.output).not.toContain("missing — skipped")
    } finally {
      rmSync(modelRun.home, { recursive: true, force: true })
      cleanup([syncRun])
      rmSync(variant, { recursive: true, force: true })
    }
  })

  it("dry-run previews install for an absent config and merge for an existing config", () => {
    const absentVariant = materializeVariant("home-fresh", {})
    const existingVariant = materializeVariant("home-fresh", {
      ".codex/config.toml": 'model = "user-choice"\n'
    })
    const absentRun = runEngine(["sync", "codex", "--dry-run"], absentVariant, makeStubDir())
    const existingRun = runEngine(["sync", "codex", "--dry-run"], existingVariant, makeStubDir())
    const installPreview =
      "[dry-run] install embedded:SoT/.codex/config.toml -> <HOME>/.codex/config.toml"
    const mergePreview =
      "[dry-run] merge embedded:SoT/.codex/config.toml -> <HOME>/.codex/config.toml"

    try {
      expect(absentRun.exitCode).toBe(0)
      expect(absentRun.output).toContain(installPreview)
      expect(absentRun.output).not.toContain(mergePreview)

      expect(existingRun.exitCode).toBe(0)
      expect(existingRun.output).toContain(mergePreview)
      expect(existingRun.output).not.toContain(installPreview)
    } finally {
      cleanup([absentRun, existingRun])
      rmSync(absentVariant, { recursive: true, force: true })
      rmSync(existingVariant, { recursive: true, force: true })
    }
  })
})
