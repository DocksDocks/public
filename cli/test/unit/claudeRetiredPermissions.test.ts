/**
 * `mergeSettings` unions the deployed permissions arrays with the SoT arrays, so
 * dropping a rule from `SoT/.claude/settings.json` never removes it from a
 * machine an earlier sync already wrote. `claudeRetired.ts
 * RETIRED_PERMISSION_RULES` plus `claudeSync.ts syncRemovals` are the cutover:
 * exact strings, force-pruned on every sync, user rules untouched.
 *
 * The kit deploys its `PowerShell(...)` deny and ask rules on every host. The
 * PowerShell tool is opt-in off Windows, not absent, so a host that enables it
 * must still carry the guards.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"

import { RETIRED_PERMISSION_RULES } from "../../src/engine-native/claudeRetired"
import { p } from "../../src/engine-native/exec"
import { isObject, parseJson } from "../../src/engine-native/jq"
import { runEngineNative } from "../../src/engine-native"
import { mergeSettings } from "../../src/engine-native/settings"
import { makeEngineServices, type EngineServices, type Logger } from "../../src/engine-native/services"
import { kitHome } from "../../src/kitHome"
import { cleanup, runEngine } from "../lib/goldenExecution"
import { cleanupTemporaryDirs, makeStubDir, materializeVariant } from "../lib/goldenResources"
import { stableStringify } from "../lib/goldenSnapshot"

afterAll(cleanupTemporaryDirs)

const SOT_SETTINGS = JSON.parse(
  readFileSync(join(kitHome(), "SoT", ".claude", "settings.json"), "utf8")
) as { permissions: Record<"allow" | "deny" | "ask", Array<string>> }

const USER_RULES = {
  allow: ["Bash(my-tool *)", "PowerShell(my-tool *)"],
  deny: ["Bash(my-destroyer *)"],
  ask: ["PowerShell(my-asker *)"]
} as const

const RETIRED = [
  ...RETIRED_PERMISSION_RULES.allow,
  ...RETIRED_PERMISSION_RULES.deny,
  ...RETIRED_PERMISSION_RULES.ask
]

/** A deployed file as an earlier kit version left it, plus user-only rules. */
function deployedBeforeThisChange(): string {
  return stableStringify({
    permissions: {
      allow: [...RETIRED_PERMISSION_RULES.allow, "Edit(./)", ...USER_RULES.allow],
      deny: [...RETIRED_PERMISSION_RULES.deny, "Bash(sudo *)", ...USER_RULES.deny],
      ask: [...USER_RULES.ask]
    },
    userOnly: "preserved"
  })
}

function permissions(home: string): Record<string, Array<string>> {
  const doc = parseJson(readFileSync(p(home, ".claude", "settings.json"), "utf8")) ?? {}
  if (!isObject(doc) || !isObject(doc["permissions"])) throw new Error("deployed settings lack permissions")
  const parsed = doc["permissions"]
  return Object.fromEntries(
    (["allow", "deny", "ask"] as const).map((key) => [
      key,
      (Array.isArray(parsed[key]) ? parsed[key] : []).filter((v): v is string => typeof v === "string")
    ])
  )
}

function recordingServices(records: Array<string>): EngineServices {
  const base = makeEngineServices()
  const logger: Logger = {
    ...base.logger,
    change: (message) => void records.push(message),
    verbose: () => {},
    warn: () => {},
    err: (message) => void records.push(message),
    echo: (message) => void records.push(message)
  }
  return { ...base, logger }
}

describe("retired permission rule cutover", () => {
  it("cannot remove a retired rule through the merge alone", () => {
    const user = parseJson(deployedBeforeThisChange()) ?? {}
    const merged = mergeSettings(SOT_SETTINGS, user)
    const allow = isObject(merged) && isObject(merged["permissions"]) ? merged["permissions"]["allow"] : []

    expect(Array.isArray(allow) ? allow : []).toContain(RETIRED_PERMISSION_RULES.allow[0])
  })

  it("drops every retired rule on a flag-less sync while keeping user and SoT rules", () => {
    const variant = materializeVariant("home-drift", {
      ".claude/settings.json": deployedBeforeThisChange()
    })
    const stubs = makeStubDir()
    const applied = runEngine(["sync", "claude"], variant, stubs)
    const replay = runEngine(["sync", "claude"], variant, stubs, { reuseHome: applied.home })
    try {
      expect(applied.exitCode, applied.output).toBe(0)
      const deployed = permissions(applied.home)
      const surviving = [...deployed["allow"], ...deployed["deny"], ...deployed["ask"]]

      for (const rule of RETIRED) expect(surviving).not.toContain(rule)
      expect(deployed["allow"]).toContain("Bash(my-tool *)")
      expect(deployed["allow"]).toContain("PowerShell(my-tool *)")
      expect(deployed["allow"]).toContain("Edit(./)")
      expect(deployed["deny"]).toContain("Bash(my-destroyer *)")
      expect(deployed["deny"]).toContain("Bash(sudo *)")
      expect(deployed["ask"]).toContain("PowerShell(my-asker *)")
      expect(applied.output).toContain("permission rules:")
      expect(replay.output).not.toContain("Pruned stale artifacts")
    } finally {
      cleanup([replay])
      rmSync(variant, { recursive: true, force: true })
    }
  })

  it("leaves sibling files under the user settings directory untouched while pruning retired rules", () => {
    // Claude Code resolves localSettings against the working directory, so a home copy is not a user-scope source.
    const untouchedSiblingFile = ".claude/settings.local.json"
    const siblingContents = stableStringify({
      permissions: {
        allow: ["Bash(git *)", "Bash(local-only *)"]
      },
      userOnly: "preserved"
    })
    const variant = materializeVariant("home-drift", {
      ".claude/settings.json": deployedBeforeThisChange(),
      [untouchedSiblingFile]: siblingContents
    })
    const applied = runEngine(["sync", "claude"], variant, makeStubDir())
    try {
      expect(applied.exitCode, applied.output).toBe(0)
      expect(readFileSync(p(applied.home, untouchedSiblingFile), "utf8")).toBe(siblingContents)
      expect(permissions(applied.home)["allow"]).not.toContain("Bash(git *)")
    } finally {
      cleanup([applied])
      rmSync(variant, { recursive: true, force: true })
    }
  })

  it("deploys the SoT PowerShell deny and ask rules on this non-Windows host", () => {
    const variant = materializeVariant("home-drift", {
      ".claude/settings.json": deployedBeforeThisChange()
    })
    const applied = runEngine(["sync", "claude"], variant, makeStubDir())
    try {
      expect(applied.exitCode, applied.output).toBe(0)
      const deployed = permissions(applied.home)

      for (const key of ["deny", "ask"] as const) {
        const shipped = SOT_SETTINGS.permissions[key].filter((rule) => rule.startsWith("PowerShell("))
        expect(shipped.length).toBeGreaterThan(0)
        expect(deployed[key]).toEqual(expect.arrayContaining(shipped))
      }
      expect(deployed["allow"].filter((rule) => rule.startsWith("PowerShell("))).toEqual([
        "PowerShell(my-tool *)"
      ])
    } finally {
      cleanup([applied])
      rmSync(variant, { recursive: true, force: true })
    }
  })

  it("counts the stale rules it would delete in dry-run", async () => {
    const home = mkdtempSync(join(tmpdir(), "claude-perms-dryrun-"))
    const previousHome = process.env["HOME"]
    const previousAgents = process.env["AGENTS_DIR"]
    const records: Array<string> = []
    mkdirSync(p(home, ".claude"), { recursive: true })
    writeFileSync(p(home, ".claude", "settings.json"), deployedBeforeThisChange())

    try {
      process.env["HOME"] = home
      process.env["AGENTS_DIR"] = p(home, ".agents")
      expect(await runEngineNative(["sync", "claude", "--dry-run"], recordingServices(records))).toBe(0)
      const output = records.join("\n")

      expect(output).toContain(`del ${RETIRED.length} stale permission rule(s)`)
      expect(readFileSync(p(home, ".claude", "settings.json"), "utf8")).toBe(deployedBeforeThisChange())
    } finally {
      if (previousHome === undefined) delete process.env["HOME"]
      else process.env["HOME"] = previousHome
      if (previousAgents === undefined) delete process.env["AGENTS_DIR"]
      else process.env["AGENTS_DIR"] = previousAgents
      rmSync(home, { recursive: true, force: true })
    }
  })
})
