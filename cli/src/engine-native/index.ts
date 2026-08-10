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
import { payloadText } from "../payload"
import { makeEngineServices, type EngineServices, type Logger } from "./services"
import type { TerminalLease } from "./logger"
import type { BunRuntimeState } from "./bun"
import { claudeNextSteps, claudeSummary, claudeSync, type ClaudeRuntimeState } from "./claudeSync"
import { codexNextSteps, codexSummary, codexSync } from "./codexSync"
import { normalizeManifest, skillsNextSteps, skillsSummary, skillsSync, type SkillsState } from "./skillsSync"
import { modeModel, modeToolchain } from "./modes"
import { ExitError, parseArgs, validateModifierFlags } from "./parseArgs"

export type ModifierFlag =
  | "--claude-model"
  | "--claude-effort"
  | "--claude-advisor"
  | "--codex-model"
  | "--codex-effort"

export type SyncConcurrency = 1 | 2 | 3
export type SyncTask<T> = () => Promise<T>

/**
 * Run input-ordered tasks with bounded overlap. Once one task rejects, queued
 * tasks stay queued while already-started tasks drain; the earliest rejection
 * in input order is then propagated.
 */
export async function runBounded<T>(
  tasks: ReadonlyArray<SyncTask<T>>,
  concurrency: SyncConcurrency
): Promise<Array<T>> {
  const results = new Array<T>(tasks.length)
  const failures = new Map<number, unknown>()
  let nextIndex = 0
  let stopped = false

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    for (;;) {
      if (stopped || nextIndex >= tasks.length) return
      const index = nextIndex
      nextIndex += 1
      try {
        results[index] = await tasks[index]!()
      } catch (error) {
        failures.set(index, error)
        stopped = true
      }
    }
  })
  await Promise.all(workers)

  for (let index = 0; index < tasks.length; index += 1) {
    if (failures.has(index)) throw failures.get(index)
  }
  return results
}

export function syncConcurrencyForManifest(
  configured: SyncConcurrency,
  manifest: string,
  claudeSelected: boolean,
  skillsSelected: boolean
): SyncConcurrency {
  if (!claudeSelected || !skillsSelected || normalizeManifest(manifest).length === 0) return configured
  return 1
}

export interface Ctx {
  readonly repoDir: string
  readonly home: string
  readonly agentsDir: string
  dryRun: boolean
  verbose: boolean
  skipBubblewrap: boolean
  skipPluginRefresh?: boolean
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
  /** Distinguishes an explicitly empty modifier from an option that was not supplied. */
  modifierFlags?: Set<ModifierFlag>
  /** Injected capability seam (logger/deps/platform) — see services.ts. */
  readonly services: EngineServices
  syncConcurrency: SyncConcurrency
  terminalLease?: TerminalLease
  bunRuntime?: Promise<BunRuntimeState>
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
    skipBubblewrap: env["SKIP_BUBBLEWRAP"] === "1",
    skipPluginRefresh: false,
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
    modifierFlags: new Set(),
    syncConcurrency: 3,
    services,
    targetFilterSet: false,
    syncClaude: false,
    syncCodex: false,
    syncAgents: false,
    nextStepTriggers: { claudePlugins: false, claudeRestart: false, codexRestart: false, skillsRestart: false }
  }
}

async function engineSync(ctx: Ctx, args: ReadonlyArray<string>): Promise<number> {
  const { acquireTerminal, echo, err } = ctx.services.logger
  parseArgs(ctx, args)
  validateModifierFlags(ctx)

  const configuredConcurrency = process.env["DOCKS_KIT_SYNC_CONCURRENCY"]
  if (configuredConcurrency === undefined || configuredConcurrency === "") {
    ctx.syncConcurrency = 3
  } else if (
    configuredConcurrency === "1" ||
    configuredConcurrency === "2" ||
    configuredConcurrency === "3"
  ) {
    ctx.syncConcurrency = Number(configuredConcurrency) as SyncConcurrency
  } else {
    err("DOCKS_KIT_SYNC_CONCURRENCY must be 1, 2, or 3")
    throw new ExitError(2)
  }

  type PipelineResult =
    | { readonly kind: "claude"; readonly runtime: ClaudeRuntimeState }
    | { readonly kind: "codex" }
    | { readonly kind: "skills"; readonly state: SkillsState }
  interface SelectedPipeline {
    readonly name: string
    readonly run: SyncTask<PipelineResult>
  }

  const selected: Array<SelectedPipeline> = []
  if (ctx.syncClaude) {
    selected.push({
      name: "Claude",
      run: async () => ({ kind: "claude", runtime: await claudeSync(ctx) })
    })
  }
  if (ctx.syncCodex) {
    selected.push({
      name: "Codex",
      run: async () => {
        await codexSync(ctx)
        return { kind: "codex" }
      }
    })
  }
  if (ctx.syncAgents) {
    selected.push({
      name: "skills",
      run: async () => ({ kind: "skills", state: await skillsSync(ctx) })
    })
  }

  // A populated skills manifest deploys with `-a claude-code codex`, and symlink healing also writes into Claude's tree.
  ctx.syncConcurrency = syncConcurrencyForManifest(
    ctx.syncConcurrency,
    payloadText("SoT/.agents/skills.txt"),
    ctx.syncClaude,
    ctx.syncAgents
  )

  const remaining = new Set(selected.map(({ name }) => name))
  const lease = acquireTerminal(`Syncing ${[...remaining].join(", ")}...`)
  ctx.terminalLease = lease
  let results: Array<PipelineResult>
  try {
    const tasks = selected.map(
      ({ name, run }): SyncTask<PipelineResult> =>
        async () => {
          try {
            return await run()
          } finally {
            remaining.delete(name)
            if (remaining.size > 0) lease.update(`Syncing ${[...remaining].join(", ")}...`)
          }
        }
    )
    results = await runBounded(tasks, ctx.syncConcurrency)
  } finally {
    lease.release()
    ctx.terminalLease = undefined
  }

  const claudeRan = ctx.syncClaude
  const codexRan = ctx.syncCodex
  let claudeRuntime: ClaudeRuntimeState | undefined
  let skillsState: SkillsState | undefined
  for (const result of results) {
    if (result.kind === "claude") claudeRuntime = result.runtime
    else if (result.kind === "skills") skillsState = result.state
  }

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


export async function runEngineNative(argv: ReadonlyArray<string>, services?: EngineServices): Promise<number> {
  let ctx!: Ctx
  const baseServices = services ?? makeEngineServices()
  const baseLogger = baseServices.logger
  const logger: Logger = {
    change: (msg) => baseLogger.change(msg),
    progress: (msg) => baseLogger.progress(msg),
    clearProgress: () => baseLogger.clearProgress(),
    verbose: (msg) => {
      if (ctx.verbose) baseLogger.verbose(msg)
    },
    warn: (msg) => baseLogger.warn(msg),
    err: (msg) => baseLogger.err(msg),
    echo: (line) => baseLogger.echo(line),
    acquireTerminal: (message) => baseLogger.acquireTerminal(message)
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
        return await modeToolchain(ctx, argv.slice(1))
      case "sync":
        return await engineSync(ctx, argv.slice(1))
      default:
        return await engineSync(ctx, argv)
    }
  } catch (e) {
    if (e instanceof ExitError) return e.code
    throw e
  }
}
