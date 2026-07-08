/**
 * EngineNative — TypeScript port of lib/engine.sh (windows-support plan,
 * step 5; module map in ./DESIGN.md).
 *
 * Selected by `DOCKS_KIT_ENGINE=native` (cli/src/main.ts bypasses @effect/cli
 * and hands the raw engine argv here, so both engines are exercised through
 * the identical vocabulary the parity harnesses drive). Bash remains the
 * default until step 6 flips it; until a command surface is fully ported,
 * dispatch refuses loudly rather than half-running it.
 */
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { kitHome } from "../kitHome"
import { codexNextSteps, codexSummary, codexSync } from "./codexSync"
import { modeModel, modeToolchain } from "./modes"
import { echo, err } from "./output"
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

/** Globals default from env exactly like the ${VAR:-default} lines in common.sh. */
function makeCtx(): Ctx {
  const env = process.env
  const home = env["HOME"] !== undefined && env["HOME"] !== "" ? env["HOME"] : homedir()
  return {
    repoDir: kitHome(),
    home,
    agentsDir: env["AGENTS_DIR"] !== undefined && env["AGENTS_DIR"] !== "" ? env["AGENTS_DIR"] : join(home, ".agents"),
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

  // Ported-surface gate: refuse BEFORE any step mutates state — a partial
  // native sync would violate the parity contract.
  if (ctx.syncClaude && existsSync(join(ctx.repoDir, "SoT", ".claude"))) {
    err("EngineNative: 'sync claude' is not ported yet — unset DOCKS_KIT_ENGINE (or set it to 'bash') to use the bash engine")
    return 2
  }
  if (ctx.syncAgents && existsSync(join(ctx.repoDir, "SoT", ".agents"))) {
    err("EngineNative: 'sync agents' is not ported yet — unset DOCKS_KIT_ENGINE (or set it to 'bash') to use the bash engine")
    return 2
  }

  const codexRan = ctx.syncCodex && existsSync(join(ctx.repoDir, "SoT", ".codex"))
  if (codexRan) codexSync(ctx)

  echo("")
  echo("--- Sync complete ---")
  echo(`Repo:     ${ctx.repoDir}`)
  if (codexRan) codexSummary(ctx)

  echo("")
  if (codexRan) codexNextSteps()
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
