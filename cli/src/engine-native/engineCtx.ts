/**
 * EngineNative run context: the shared `Ctx` shape plus its construction from
 * the environment. Split from index.ts, which re-exports the public surface
 * so existing import paths keep working.
 */
import { p } from "./exec";
import { engineHome } from "./harnesses";
import type { TerminalLease } from "./logger";
import type { BunRuntimeState } from "./bun";
import { kitHome } from "../kitHome";
import { ExitError, parseClaudePlugin, parseCompactWindow } from "./parseArgs";
import type { EngineServices } from "./services";
import type { SyncConcurrency } from "./syncConcurrency";

export type ModifierFlag =
  | "--claude-model"
  | "--claude-effort"
  | "--claude-advisor"
  | "--claude-compact-window"
  | "--claude-permissive"
  | "--claude-plugin"
  | "--codex-model"
  | "--codex-effort";

export interface Ctx {
  readonly repoDir: string;
  readonly home: string;
  readonly agentsDir: string;
  readonly interactive: boolean;
  dryRun: boolean;
  verbose: boolean;
  skipBubblewrap: boolean;
  skipPluginRefresh?: boolean;
  reconcile: boolean;
  prune: boolean;
  claudeCompactWindow: string;
  claudePermissive: boolean;
  claudePlugins: Array<string>;
  claudeModel: string;
  claudeEffort: string;
  claudeAdvisor: string;
  codexModel: string;
  codexEffort: string;
  /** Distinguishes an explicitly empty modifier from an option that was not supplied. */
  modifierFlags?: Set<ModifierFlag>;
  /** Injected capability seam (logger/deps/platform) — see services.ts. */
  readonly services: EngineServices;
  syncConcurrency: SyncConcurrency;
  terminalLease?: TerminalLease;
  bunRuntime?: Promise<BunRuntimeState>;
  targetFilterSet: boolean;
  syncClaude: boolean;
  syncCodex: boolean;
  syncAgents: boolean;
  syncOmp: boolean;
  /** Per-run next-step triggers (Output Policy): advice prints only when its trigger changed or --verbose. */
  readonly nextStepTriggers: {
    claudePlugins: boolean;
    claudeRestart: boolean;
    codexRestart: boolean;
    skillsRestart: boolean;
    ompRestart: boolean;
  };
  /** Harness-CLI operations that failed this run; a non-empty list fails the sync. */
  readonly failures: Array<string>;
}

/**
 * Unprefixed env globals that seed `Ctx` with the historical ${VAR:-default}
 * contract. Only the harness-private native-raw channel honors them; the
 * public CLI takes the same behavior from flags.
 */
export const ENV_GLOBAL_KEYS = [
  "DRY_RUN",
  "DOCKS_KIT_VERBOSE",
  "SKIP_BUBBLEWRAP",
  "RECONCILE",
  "PRUNE",
  "CLAUDE_PERMISSIVE",
  "CLAUDE_MODEL",
  "CODEX_MODEL",
  "CLAUDE_PLUGINS",
  "CLAUDE_COMPACT_WINDOW",
  "AGENTS_DIR",
] as const;

export interface CtxOptions {
  /** True only on the native-raw channel: read ENV_GLOBAL_KEYS from the environment. */
  readonly envGlobals: boolean;
}

/**
 * Build the run context. HOME and DOCKS_KIT_INTERACTIVE apply on every path;
 * ENV_GLOBAL_KEYS apply only when `options.envGlobals` is true.
 */
export function makeCtx(services: EngineServices, options: CtxOptions): Ctx {
  const env = process.env;
  const home = engineHome(env);
  const globals: NodeJS.ProcessEnv = options.envGlobals ? env : {};
  const compactWindowSource = globals["CLAUDE_COMPACT_WINDOW"] ?? "";
  const claudeCompactWindow =
    compactWindowSource === "" ? "" : parseCompactWindow(compactWindowSource);
  if (claudeCompactWindow === undefined) {
    services.logger.err("CLAUDE_COMPACT_WINDOW expects a token count (e.g. 680000 or 680k)");
    throw new ExitError(2);
  }
  const claudePlugins = (globals["CLAUDE_PLUGINS"] ?? "")
    .split(" ")
    .filter((plugin) => plugin !== "")
    .map((plugin) => parseClaudePlugin(plugin, services.logger.err));
  return {
    repoDir: kitHome(),
    home,
    agentsDir:
      globals["AGENTS_DIR"] !== undefined && globals["AGENTS_DIR"] !== ""
        ? globals["AGENTS_DIR"]
        : p(home, ".agents"),
    interactive:
      env["DOCKS_KIT_INTERACTIVE"] === "1" ||
      (env["DOCKS_KIT_INTERACTIVE"] !== "0" &&
        process.stdout.isTTY === true &&
        process.stdin.isTTY === true),
    dryRun: globals["DRY_RUN"] === "1",
    verbose: globals["DOCKS_KIT_VERBOSE"] === "1",
    skipBubblewrap: globals["SKIP_BUBBLEWRAP"] === "1",
    skipPluginRefresh: false,
    reconcile: globals["RECONCILE"] === "1",
    prune: globals["PRUNE"] === "1",
    claudeCompactWindow,
    claudePermissive: globals["CLAUDE_PERMISSIVE"] === "1",
    claudePlugins,
    claudeModel: globals["CLAUDE_MODEL"] ?? "",
    claudeEffort: "",
    claudeAdvisor: "",
    codexModel: globals["CODEX_MODEL"] ?? "",
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
      ompRestart: false,
    },
    failures: [],
  };
}
