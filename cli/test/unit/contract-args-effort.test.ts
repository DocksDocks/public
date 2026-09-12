import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Ctx } from "../../src/engine-native"
import { p } from "../../src/engine-native/exec"
import { ExitError, parseArgs, parseClaudePlugin, parseCompactWindow, validateModifierFlags } from "../../src/engine-native/parseArgs"
import { makeEngineServices } from "../../src/engine-native/services"
import { kitHome } from "../../src/kitHome"
import {
  CLAUDE_EFFORT_LEVELS,
  CODEX_REASONING_EFFORTS,
  effortFlagGrammar,
  effortModifierValues,
  effortValueGrammar,
  isEffortModifierValue,
  resolveEffort,
  validateEffortDefault
} from "../../src/efforts"

function makeCtx(home: string): Ctx {
  return {
    repoDir: kitHome(),
    home,
    agentsDir: p(home, ".agents"),
    interactive: false,
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
    services: makeEngineServices({ sinks: { stderr: () => {}, stdout: () => {} } }),
    syncConcurrency: 3,
    targetFilterSet: false,
    syncClaude: false,
    syncCodex: false,
    syncAgents: false,
    syncOmp: false,
    nextStepTriggers: {
      claudePlugins: false,
      claudeRestart: false,
      codexRestart: false,
      skillsRestart: false,
      ompRestart: false
    },
    failures: []
  }
}

function exitCode(run: () => void): number {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(ExitError)
    return (error as ExitError).code
  }
  throw new Error("expected ExitError")
}

describe("arg and effort contract", () => {
  let home = ""

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "docks-kit-contract-args-"))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it("normalizes compact-window tokens and rejects junk", () => {
    expect(parseCompactWindow("680000")).toBe("680000")
    expect(parseCompactWindow("680k")).toBe("680000")
    expect(parseCompactWindow("680K")).toBe("680000")
    expect(parseCompactWindow("0")).toBe("0")
    expect(parseCompactWindow("")).toBeUndefined()
    expect(parseCompactWindow("k")).toBeUndefined()
    expect(parseCompactWindow("abc")).toBeUndefined()
    expect(parseCompactWindow("12.5k")).toBeUndefined()
    expect(parseCompactWindow("-5")).toBeUndefined()
    expect(parseCompactWindow("680 k")).toBeUndefined()
  })

  it("accepts known plugins and rejects unknown ones with code 2", () => {
    expect(parseClaudePlugin("supabase", () => {})).toBe("supabase")
    const messages: Array<string> = []
    const code = exitCode(() => parseClaudePlugin("bogus", (message) => void messages.push(message)))

    expect(code).toBe(2)
    expect(messages.join("\n")).toContain("bogus")
  })

  it("keeps per-tool effort vocabularies distinct with a default suffix", () => {
    expect(effortModifierValues("claude")).toEqual([...CLAUDE_EFFORT_LEVELS, "default"])
    expect(effortModifierValues("codex")).toEqual([...CODEX_REASONING_EFFORTS, "default"])
    expect(effortValueGrammar("claude")).toBe(effortModifierValues("claude").join("|"))
    expect(effortFlagGrammar("claude")).toBe(`--claude-effort=<${effortValueGrammar("claude")}>`)
    expect(effortFlagGrammar("codex")).toBe(`--codex-effort=<${effortValueGrammar("codex")}>`)
    expect(isEffortModifierValue("claude", "ultra")).toBe(false)
    expect(isEffortModifierValue("codex", "ultra")).toBe(true)
    expect(isEffortModifierValue("codex", "bogus")).toBe(false)
  })

  it("validates embedded defaults with tool-specific messages", () => {
    expect(validateEffortDefault("claude", "low")).toBe("low")
    expect(() => validateEffortDefault("claude", "")).toThrow("Embedded SoT Claude effortLevel is missing")
    expect(() => validateEffortDefault("codex", undefined)).toThrow(
      "Embedded SoT Codex model_reasoning_effort is missing"
    )
    expect(() => validateEffortDefault("claude", "ultra")).toThrow(
      "Embedded SoT Claude effortLevel 'ultra' is outside the verified catalog"
    )
  })

  it("resolves explicit efforts and rejects unknown values", () => {
    expect(resolveEffort("claude", "low")).toBe("low")
    expect(resolveEffort("codex", "ultra")).toBe("ultra")
    expect(() => resolveEffort("claude", "bogus")).toThrow("Invalid claude effort 'bogus'")
    expect(() => resolveEffort("codex", "bogus")).toThrow("Invalid codex effort 'bogus'")
  })

  it("resolves default inside the upstream vocabulary", () => {
    expect(CLAUDE_EFFORT_LEVELS).toContain(resolveEffort("claude", "default"))
    expect(CODEX_REASONING_EFFORTS).toContain(resolveEffort("codex", "default"))
  })

  it("selects the legacy targets for empty input when non-interactive", () => {
    const ctx = makeCtx(home)

    parseArgs(ctx, [])

    expect([ctx.syncClaude, ctx.syncCodex, ctx.syncAgents, ctx.syncOmp]).toEqual([true, true, true, false])
  })

  it("rejects unknown positionals and renamed flags with code 2", () => {
    for (const args of [
      ["bogus"],
      ["--claude"],
      ["--force"],
      ["--remove-plugins"],
      ["--permissive"],
      ["--claude-compact-window=abc"],
      ["--claude-permissive=yes"]
    ]) {
      expect(exitCode(() => parseArgs(makeCtx(home), args)), args.join(" ")).toBe(2)
    }
  })

  it("requires values for bare scalar flags with code 2", () => {
    for (const args of [["--claude-model"], ["--codex-model"], ["--claude-effort"], ["--codex-effort"]]) {
      expect(exitCode(() => parseArgs(makeCtx(home), args)), args.join(" ")).toBe(2)
    }
  })

  it("rejects invalid modifier values with code 2 and accepts valid ones", () => {
    const badEffort = makeCtx(home)
    badEffort.syncClaude = true
    badEffort.claudeEffort = "bogus"
    expect(exitCode(() => validateModifierFlags(badEffort))).toBe(2)

    const badModel = makeCtx(home)
    badModel.syncCodex = true
    badModel.codexModel = "has space"
    expect(exitCode(() => validateModifierFlags(badModel))).toBe(2)

    const good = makeCtx(home)
    good.syncClaude = true
    good.claudeEffort = "low"
    good.syncCodex = true
    good.codexModel = "gpt-5.5"
    validateModifierFlags(good)
    expect(good.claudeEffort).toBe("low")
  })
})
