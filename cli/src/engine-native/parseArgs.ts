/**
 * EngineNative flag layer: usage / target selection / compact-window parsing /
 * optional-plugin parsing / model validation / preflight. ExitError mirrors an
 * early parser exit and is caught once in runEngineNative.
 */

import { DEPENDENCIES } from "./deps"
import { commandExists } from "./exec"
import type { Ctx } from "./index"
import { printModels, validateClaudeModel, validateCodexModel } from "./models"
import { echo, err, setVerbose, warn } from "./logger"

export class ExitError extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`)
  }
}

const KNOWN_CLAUDE_OPTIN_PLUGINS = ["supabase", "n8n"]

function usage(ctx: Ctx): void {
  const argv0 = "docks-kit sync"
  echo(`Usage: ${argv0} [claude] [codex] [agents] [flags]`)
  echo("")
  echo("Targets (positional; default: all three)")
  echo("  claude            sync the Claude Code SoT")
  echo("  codex             sync the Codex SoT")
  echo("  agents            sync universal agent skills")
  echo("")
  echo("Global flags")
  echo("  --dry-run         preview without applying")
  echo(
    "  --reconcile       reconcile kit-owned settings with SoT (SoT keys win; user-only keys preserved; permissions arrays replaced)"
  )
  echo(
    "  --prune           uninstall kit-managed installs not in SoT (plugins, marketplaces, skills in SoT/.agents/skills.txt)"
  )
  echo("  --skip-rtk        skip optional tool bootstrap (RTK, bubblewrap)")
  echo("  --yes             auto-accept toolchain prompts (containers/CI)")
  echo("  --verbose         also print no-op confirmations (already in sync, up to date, left as-is)")
  echo("")
  echo("Deploy-time modifiers (deployed config only; SoT untouched; a later flag-less sync reverts)")
  echo(
    "  --claude-model=<m>            set deployed ~/.claude/settings.json model (aliases: best|opus|fable|sonnet|haiku, full claude-* IDs, or 'default' to unset)"
  )
  echo(
    "  --claude-compact-window=<n>   set deployed autocompact window in tokens (e.g. 680000 or 680k) for disposable sessions"
  )
  echo(
    "  --claude-permissive           empty permissions.ask/deny in deployed settings (sandboxes/containers; unattended commits + pushes)"
  )
  echo("  --codex-model=<m>             set deployed ~/.codex/config.toml model (e.g. gpt-5.5)")
  echo("")
  echo("Sticky opt-ins (installed + enabled until --prune)")
  echo(
    `  --claude-plugin=<name>        opt an optional plugin into this machine (known: ${KNOWN_CLAUDE_OPTIN_PLUGINS.join(", ")}; repeatable)`
  )
}

/** common::parse_compact_window — normalized tokens or undefined on junk. */
export function parseCompactWindow(v: string): string | undefined {
  if (/[kK]$/.test(v)) {
    const n = v.slice(0, -1)
    if (!/^[0-9]+$/.test(n)) return undefined
    return String(parseInt(n, 10) * 1000)
  }
  return /^[0-9]+$/.test(v) ? v : undefined
}

function addClaudePlugin(ctx: Ctx, name: string): void {
  if (!KNOWN_CLAUDE_OPTIN_PLUGINS.includes(name)) {
    err(`Unknown opt-in plugin '${name}'. Known: ${KNOWN_CLAUDE_OPTIN_PLUGINS.join(", ")}`)
    throw new ExitError(2)
  }
  ctx.claudePlugins.push(name)
}

function selectTarget(ctx: Ctx, target: string): void {
  if (target === "claude") ctx.syncClaude = true
  else if (target === "codex") ctx.syncCodex = true
  else ctx.syncAgents = true
  ctx.targetFilterSet = true
}

export function parseArgs(ctx: Ctx, args: ReadonlyArray<string>): void {
  for (const arg of args) {
    switch (arg) {
      case "claude":
      case "codex":
      case "agents":
        selectTarget(ctx, arg)
        continue
      case "--dry-run":
        ctx.dryRun = true
        continue
      case "--skip-rtk":
        ctx.skipRtk = true
        continue
      case "--reconcile":
        ctx.reconcile = true
        continue
      case "--prune":
        ctx.prune = true
        continue
      case "--yes":
        ctx.assumeYes = true
        continue
      case "--verbose":
        ctx.verbose = true
        setVerbose(true)
        continue
      case "--claude-model":
        printModels(ctx.repoDir, "claude")
        err("--claude-model requires a value: --claude-model=<model>")
        throw new ExitError(2)
      case "--codex-model":
        printModels(ctx.repoDir, "codex")
        err("--codex-model requires a value: --codex-model=<model>")
        throw new ExitError(2)
      case "--claude-compact-window":
        err("--claude-compact-window requires a value: --claude-compact-window=<tokens> (e.g. 680k)")
        throw new ExitError(2)
      case "--claude-permissive":
        ctx.claudePermissive = true
        continue
      case "--claude-plugin":
        err(`--claude-plugin requires a value: --claude-plugin=<${KNOWN_CLAUDE_OPTIN_PLUGINS.join("|")}>`)
        throw new ExitError(2)
      case "--claude":
      case "--codex":
      case "--agents":
        err(`${arg} was renamed: pass the target as a word, e.g. 'sync ${arg.slice(2)}'`)
        throw new ExitError(2)
      case "--force":
        err("--force was renamed to --reconcile")
        throw new ExitError(2)
      case "--remove-plugins":
        err("--remove-plugins was renamed to --prune (it also removes marketplaces + kit-managed skills)")
        throw new ExitError(2)
      case "--680k":
        err("--680k was renamed to --claude-compact-window=680k")
        throw new ExitError(2)
      case "--permissive":
        err("--permissive was renamed to --claude-permissive")
        throw new ExitError(2)
      case "--supabase":
        err("--supabase was renamed to --claude-plugin=supabase")
        throw new ExitError(2)
      case "--n8n":
        err("--n8n was renamed to --claude-plugin=n8n")
        throw new ExitError(2)
      case "--no-rtk":
        err("--no-rtk was renamed to --skip-rtk")
        throw new ExitError(2)
      case "-h":
      case "--help":
        usage(ctx)
        throw new ExitError(0)
      default:
        break
    }
    if (arg.startsWith("--claude-model=")) {
      ctx.claudeModel = arg.slice("--claude-model=".length)
    } else if (arg.startsWith("--codex-model=")) {
      ctx.codexModel = arg.slice("--codex-model=".length)
    } else if (arg.startsWith("--claude-compact-window=")) {
      const parsed = parseCompactWindow(arg.slice("--claude-compact-window=".length))
      if (parsed === undefined) {
        err("--claude-compact-window expects a token count (e.g. 680000 or 680k)")
        throw new ExitError(2)
      }
      ctx.claudeCompactWindow = parsed
    } else if (arg.startsWith("--claude-plugin=")) {
      addClaudePlugin(ctx, arg.slice("--claude-plugin=".length))
    } else {
      err(`Unknown arg: ${arg}`)
      throw new ExitError(2)
    }
  }

  if (!ctx.targetFilterSet) {
    ctx.syncClaude = true
    ctx.syncCodex = true
    ctx.syncAgents = true
  }
}

export function preflight(ctx: Ctx): void {
  if (ctx.syncClaude || ctx.syncCodex) {
    if (!commandExists("jq")) {
      err(`jq is required (deployed statusline/hooks call it). Install: ${DEPENDENCIES.jq.installHint()}`)
      throw new ExitError(1)
    }
  }
  if (ctx.syncClaude) {
    if (!commandExists("curl")) {
      err(`curl is required. Install: ${DEPENDENCIES.curl.installHint()}`)
      throw new ExitError(1)
    }
  }
}

export function validateModelFlags(ctx: Ctx): void {
  if (ctx.claudeModel !== "") {
    if (!ctx.syncClaude) {
      warn("--claude-model ignored: claude target not selected")
      ctx.claudeModel = ""
    } else if (!validateClaudeModel(ctx.repoDir, ctx.claudeModel)) {
      printModels(ctx.repoDir, "claude")
      err(`Invalid Claude model '${ctx.claudeModel}' — use an alias above or a full claude-* ID`)
      throw new ExitError(2)
    }
  }
  if (ctx.codexModel !== "") {
    if (!ctx.syncCodex) {
      warn("--codex-model ignored: codex target not selected")
      ctx.codexModel = ""
    } else if (!validateCodexModel(ctx.repoDir, ctx.codexModel)) {
      printModels(ctx.repoDir, "codex")
      err(`Invalid Codex model '${ctx.codexModel}' — must match ^[A-Za-z0-9._-]+$`)
      throw new ExitError(2)
    }
  }
}
