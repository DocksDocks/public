/**
 * EngineNative — the supported sync/model/toolchain engine.
 *
 * Golden suites drive it through main.ts's harness-private `native-raw`
 * channel, which bypasses @effect/cli so tests see the internal argv
 * vocabulary directly.
 */
import { p } from "./exec"
import { existsSync } from "node:fs"
import { homedir } from "node:os"

import { kitHome } from "../kitHome"
import { claudeNextSteps, claudeSummary, claudeSync } from "./claudeSync"
import { codexNextSteps, codexSummary, codexSync } from "./codexSync"
import { skillsNextSteps, skillsSummary, skillsSync } from "./skillsSync"
import { modeModel, modeToolchain } from "./modes"
import { echo } from "./output"
import { ExitError, parseArgs, preflight, validateModelFlags } from "./parseArgs"

export interface Ctx {
  readonly repoDir: string
  readonly home: string
  readonly agentsDir: string
  dryRun: boolean
  skipRtk: boolean
  reconcile: boolean
  prune: boolean
  assumeYes: boolean
  claudeCompactWindow: string
  claudePermissive: boolean
  claudePlugins: Array<string>
  claudeModel: string
  codexModel: string
  targetFilterSet: boolean
  syncClaude: boolean
  syncCodex: boolean
  syncAgents: boolean
}

/** Globals default from env using the historical ${VAR:-default} contract. */
function makeCtx(): Ctx {
  const env = process.env
  const home = env["HOME"] !== undefined && env["HOME"] !== "" ? env["HOME"] : homedir()
  return {
    repoDir: kitHome(),
    home,
    agentsDir: env["AGENTS_DIR"] !== undefined && env["AGENTS_DIR"] !== "" ? env["AGENTS_DIR"] : p(home, ".agents"),
    dryRun: env["DRY_RUN"] === "1",
    skipRtk: env["SKIP_RTK"] === "1",
    reconcile: env["RECONCILE"] === "1",
    prune: env["PRUNE"] === "1",
    assumeYes: env["ASSUME_YES"] === "1",
    claudeCompactWindow: env["CLAUDE_COMPACT_WINDOW"] ?? "",
    claudePermissive: env["CLAUDE_PERMISSIVE"] === "1",
    claudePlugins: (env["CLAUDE_PLUGINS"] ?? "").split(" ").filter((s) => s !== ""),
    claudeModel: env["CLAUDE_MODEL"] ?? "",
    codexModel: env["CODEX_MODEL"] ?? "",
    targetFilterSet: false,
    syncClaude: false,
    syncCodex: false,
    syncAgents: false
  }
}

function engineSync(ctx: Ctx, args: ReadonlyArray<string>): number {
  parseArgs(ctx, args)
  preflight(ctx)
  validateModelFlags(ctx)

  const claudeRan = ctx.syncClaude && existsSync(p(ctx.repoDir, "SoT", ".claude"))
  if (claudeRan) claudeSync(ctx)

  const codexRan = ctx.syncCodex && existsSync(p(ctx.repoDir, "SoT", ".codex"))
  if (codexRan) codexSync(ctx)

  const skillsState = ctx.syncAgents && existsSync(p(ctx.repoDir, "SoT", ".agents")) ? skillsSync(ctx) : undefined

  echo("")
  echo("--- Sync complete ---")
  echo(`Repo:     ${ctx.repoDir}`)
  if (claudeRan) claudeSummary(ctx)
  if (codexRan) codexSummary(ctx)
  if (skillsState !== undefined) skillsSummary(ctx, skillsState)

  echo("")
  if (claudeRan) claudeNextSteps()
  if (codexRan) codexNextSteps()
  if (skillsState !== undefined) skillsNextSteps()
  return 0
}

export function runEngineNative(argv: ReadonlyArray<string>): number {
  const ctx = makeCtx()
  try {
    switch (argv[0]) {
      case "model":
        return modeModel(ctx, argv.slice(1))
      case "toolchain":
        return modeToolchain(ctx, argv.slice(1))
      case "sync":
        return engineSync(ctx, argv.slice(1))
      default:
        return engineSync(ctx, argv)
    }
  } catch (e) {
    if (e instanceof ExitError) return e.code
    throw e
  }
}
