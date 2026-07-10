/**
 * EngineNative — the supported sync/model/toolchain engine.
 *
 * Golden suites drive it through main.ts's harness-private `native-raw`
 * channel, which bypasses @effect/cli so tests see the internal argv
 * vocabulary directly.
 */
import { p } from "./exec"
import { homedir } from "node:os"

import { kitHome } from "../kitHome"
import { makeEngineServices, type EngineServices, type Logger } from "./services"
import type { BunRuntimeState } from "./bun"
import { claudeNextSteps, claudeSummary, claudeSync } from "./claudeSync"
import { codexNextSteps, codexSummary, codexSync } from "./codexSync"
import { skillsNextSteps, skillsSummary, skillsSync } from "./skillsSync"
import { modeModel, modeToolchain } from "./modes"
import { ExitError, parseArgs, validateModifierFlags } from "./parseArgs"

export interface Ctx {
  readonly repoDir: string
  readonly home: string
  readonly agentsDir: string
  dryRun: boolean
  verbose: boolean
  skipRtk: boolean
  reconcile: boolean
  prune: boolean
  assumeYes: boolean
  claudeCompactWindow: string
  claudePermissive: boolean
  claudePlugins: Array<string>
  claudeModel: string
  claudeEffort: string
  claudeAdvisor: string
  codexModel: string
  codexEffort: string
  /** Injected capability seam (logger/deps/platform) — see services.ts. */
  readonly services: EngineServices
  bunRuntime?: BunRuntimeState
  targetFilterSet: boolean
  syncClaude: boolean
  syncCodex: boolean
  syncAgents: boolean
  /** Per-run next-step triggers (Output Policy): advice prints only when its trigger changed or --verbose. */
  readonly nextStepTriggers: {
    claudePlugins: boolean
    claudeRestart: boolean
    codexRestart: boolean
    skillsRestart: boolean
  }
}

/** Globals default from env using the historical ${VAR:-default} contract. */
function makeCtx(services: EngineServices): Ctx {
  const env = process.env
  const home = env["HOME"] !== undefined && env["HOME"] !== "" ? env["HOME"] : homedir()
  return {
    repoDir: kitHome(),
    home,
    agentsDir: env["AGENTS_DIR"] !== undefined && env["AGENTS_DIR"] !== "" ? env["AGENTS_DIR"] : p(home, ".agents"),
    dryRun: env["DRY_RUN"] === "1",
    verbose: env["DOCKS_KIT_VERBOSE"] === "1",
    skipRtk: env["SKIP_RTK"] === "1",
    reconcile: env["RECONCILE"] === "1",
    prune: env["PRUNE"] === "1",
    assumeYes: env["ASSUME_YES"] === "1",
    claudeCompactWindow: env["CLAUDE_COMPACT_WINDOW"] ?? "",
    claudePermissive: env["CLAUDE_PERMISSIVE"] === "1",
    claudePlugins: (env["CLAUDE_PLUGINS"] ?? "").split(" ").filter((s) => s !== ""),
    claudeModel: env["CLAUDE_MODEL"] ?? "",
    claudeEffort: "",
    claudeAdvisor: "",
    codexModel: env["CODEX_MODEL"] ?? "",
    codexEffort: "",
    services,
    targetFilterSet: false,
    syncClaude: false,
    syncCodex: false,
    syncAgents: false,
    nextStepTriggers: { claudePlugins: false, claudeRestart: false, codexRestart: false, skillsRestart: false }
  }
}

function engineSync(ctx: Ctx, args: ReadonlyArray<string>): number {
  const { echo } = ctx.services.logger
  parseArgs(ctx, args)
  validateModifierFlags(ctx)

  const claudeRan = ctx.syncClaude
  const claudeRuntime = claudeRan ? claudeSync(ctx) : undefined

  const codexRan = ctx.syncCodex
  if (codexRan) codexSync(ctx)

  const skillsState = ctx.syncAgents ? skillsSync(ctx) : undefined

  echo("")
  echo("--- Sync complete ---")
  echo(`Repo:     ${ctx.repoDir}`)
  if (claudeRuntime !== undefined) claudeSummary(ctx, claudeRuntime)
  if (codexRan) codexSummary(ctx)
  if (skillsState !== undefined) skillsSummary(ctx, skillsState)

  const advice = [
    ...(claudeRan ? claudeNextSteps(ctx) : []),
    ...(codexRan ? codexNextSteps(ctx) : []),
    ...(skillsState !== undefined ? skillsNextSteps(ctx) : [])
  ]
  if (advice.length > 0) {
    echo("")
    for (const line of advice) echo(line)
  }
  return 0
}

export function runEngineNative(argv: ReadonlyArray<string>, services?: EngineServices): number {
  let ctx!: Ctx
  const baseServices = services ?? makeEngineServices()
  const baseLogger = baseServices.logger
  const logger: Logger = {
    change: (msg) => baseLogger.change(msg),
    verbose: (msg) => {
      if (ctx.verbose) baseLogger.verbose(msg)
    },
    warn: (msg) => baseLogger.warn(msg),
    err: (msg) => baseLogger.err(msg),
    echo: (line) => baseLogger.echo(line)
  }
  const runServices: EngineServices = {
    logger,
    deps: baseServices.deps,
    platform: baseServices.platform
  }
  ctx = makeCtx(runServices)
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
