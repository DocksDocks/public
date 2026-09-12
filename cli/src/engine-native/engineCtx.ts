/**
 * EngineNative run context: the shared `Ctx` shape plus its construction from
 * the environment. Split from index.ts, which re-exports the public surface
 * so existing import paths keep working.
 */
import { p } from "./exec"
import { engineHome } from "./harnesses"
import type { TerminalLease } from "./logger"
import type { BunRuntimeState } from "./bun"
import { kitHome } from "../kitHome"
import { ExitError, parseClaudePlugin, parseCompactWindow } from "./parseArgs"
import type { EngineServices } from "./services"
import type { SyncConcurrency } from "./syncConcurrency"

export type ModifierFlag =
  | "--claude-model"
  | "--claude-effort"
  | "--claude-advisor"
  | "--claude-compact-window"
  | "--claude-permissive"
  | "--claude-plugin"
  | "--codex-model"
  | "--codex-effort"

export interface Ctx {
  readonly repoDir: string
  readonly home: string
  readonly agentsDir: string
  readonly interactive: boolean
  dryRun: boolean
  verbose: boolean
  skipBubblewrap: boolean
  skipPluginRefresh?: boolean
  reconcile: boolean
  prune: boolean
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
  syncOmp: boolean
  /** Per-run next-step triggers (Output Policy): advice prints only when its trigger changed or --verbose. */
  readonly nextStepTriggers: {
    claudePlugins: boolean
    claudeRestart: boolean
    codexRestart: boolean
    skillsRestart: boolean
    ompRestart: boolean
  }
  /** Harness-CLI operations that failed this run; a non-empty list fails the sync. */
  readonly failures: Array<string>
}

/** Globals default from env using the historical ${VAR:-default} contract. */
export function makeCtx(services: EngineServices): Ctx {
  const env = process.env
  const home = engineHome(env)
  const compactWindowSource = env["CLAUDE_COMPACT_WINDOW"] ?? ""
  const claudeCompactWindow = compactWindowSource === "" ? "" : parseCompactWindow(compactWindowSource)
  if (claudeCompactWindow === undefined) {
    services.logger.err("CLAUDE_COMPACT_WINDOW expects a token count (e.g. 680000 or 680k)")
    throw new ExitError(2)
  }
  const claudePlugins = (env["CLAUDE_PLUGINS"] ?? "")
    .split(" ")
    .filter((plugin) => plugin !== "")
    .map((plugin) => parseClaudePlugin(plugin, services.logger.err))
  return {
    repoDir: kitHome(),
    home,
    agentsDir: env["AGENTS_DIR"] !== undefined && env["AGENTS_DIR"] !== "" ? env["AGENTS_DIR"] : p(home, ".agents"),
    interactive:
      env["DOCKS_KIT_INTERACTIVE"] === "1" ||
      (env["DOCKS_KIT_INTERACTIVE"] !== "0" &&
        process.stdout.isTTY === true &&
        process.stdin.isTTY === true),
    dryRun: env["DRY_RUN"] === "1",
    verbose: env["DOCKS_KIT_VERBOSE"] === "1",
    skipBubblewrap: env["SKIP_BUBBLEWRAP"] === "1",
    skipPluginRefresh: false,
    reconcile: env["RECONCILE"] === "1",
    prune: env["PRUNE"] === "1",
    claudeCompactWindow,
    claudePermissive: env["CLAUDE_PERMISSIVE"] === "1",
    claudePlugins,
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
