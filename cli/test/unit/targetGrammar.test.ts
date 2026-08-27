import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Ctx } from "../../src/engine-native"
import { p } from "../../src/engine-native/exec"
import {
  harnessStateFile,
  writeHarnessSelection
} from "../../src/engine-native/harnesses"
import { ExitError, parseArgs } from "../../src/engine-native/parseArgs"
import { makeEngineServices } from "../../src/engine-native/services"
import { kitHome } from "../../src/kitHome"

function targetCtx(home: string, interactive: boolean, echoes: Array<string>): Ctx {
  return {
    repoDir: kitHome(),
    home,
    agentsDir: p(home, ".agents"),
    interactive,
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
    services: makeEngineServices({
      sinks: {
        stderr: () => {},
        stdout: (chunk) => void echoes.push(chunk.replace(/\n$/, ""))
      }
    }),
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
    }
  }
}

function selectedTargets(ctx: Ctx) {
  return {
    claude: ctx.syncClaude,
    codex: ctx.syncCodex,
    agents: ctx.syncAgents,
    omp: ctx.syncOmp
  }
}

describe("sync target grammar", () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "docks-kit-targets-"))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it("selects only omp when omp is explicit", () => {
    const ctx = targetCtx(home, false, [])

    parseArgs(ctx, ["omp"])

    expect(selectedTargets(ctx)).toEqual({ claude: false, codex: false, agents: false, omp: true })
  })

  it("selects exactly explicit claude and codex targets", () => {
    const ctx = targetCtx(home, false, [])

    parseArgs(ctx, ["claude", "codex"])

    expect(selectedTargets(ctx)).toEqual({ claude: true, codex: true, agents: false, omp: false })
  })

  it("ignores a stored selection when an explicit target is present", () => {
    writeHarnessSelection(home, ["omp"])
    const ctx = targetCtx(home, false, [])

    parseArgs(ctx, ["claude"])

    expect(selectedTargets(ctx)).toEqual({ claude: true, codex: false, agents: false, omp: false })
  })

  it("uses a stored omp-only selection for a flag-less parse", () => {
    writeHarnessSelection(home, ["omp"])
    const ctx = targetCtx(home, false, [])

    parseArgs(ctx, [])

    expect(selectedTargets(ctx)).toEqual({ claude: false, codex: false, agents: false, omp: true })
  })

  it("uses exactly a stored claude and omp selection", () => {
    writeHarnessSelection(home, ["claude", "omp"])
    const ctx = targetCtx(home, false, [])

    parseArgs(ctx, [])

    expect(selectedTargets(ctx)).toEqual({ claude: true, codex: false, agents: false, omp: true })
  })

  it("uses the legacy selection silently without stored state when non-interactive", () => {
    const echoes: Array<string> = []
    const ctx = targetCtx(home, false, echoes)

    parseArgs(ctx, [])

    expect(selectedTargets(ctx)).toEqual({ claude: true, codex: true, agents: true, omp: false })
    expect(echoes).toEqual([])
  })

  it("prints both selection hints in order without stored state when interactive", () => {
    const echoes: Array<string> = []
    const ctx = targetCtx(home, true, echoes)

    parseArgs(ctx, [])

    expect(selectedTargets(ctx)).toEqual({ claude: true, codex: true, agents: true, omp: false })
    expect(echoes).toEqual([
      "No harness selection stored; syncing claude, codex, agents",
      "Choose harnesses with: docks-kit harnesses"
    ])
  })

  it("prints no selection hints for stored state when interactive", () => {
    writeHarnessSelection(home, ["omp"])
    const echoes: Array<string> = []
    const ctx = targetCtx(home, true, echoes)

    parseArgs(ctx, [])

    expect(echoes).toEqual([])
  })

  it("never creates the harness state file during a flag-less parse", () => {
    const ctx = targetCtx(home, true, [])

    parseArgs(ctx, [])

    expect(existsSync(harnessStateFile(home))).toBe(false)
  })

  it("keeps unknown positional targets on the ExitError code 2 path", () => {
    const ctx = targetCtx(home, false, [])
    let thrown: unknown

    try {
      parseArgs(ctx, ["bogus"])
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ExitError)
    expect((thrown as ExitError).code).toBe(2)
  })
})
