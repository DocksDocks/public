/**
 * EngineNative flag layer: usage / target selection / compact-window parsing /
 * optional-plugin parsing / model validation. ExitError mirrors an
 * early parser exit and is caught once in runEngineNative.
 */

import type { Ctx, ModifierFlag } from "./index"
import { LEGACY_SELECTION, readHarnessSelection, type Harness } from "./harnesses"
import {
  CLAUDE_ADVISOR_STATES,
  advisorCatalog,
  advisorFlagGrammar,
  advisorValueGrammar,
  effortCatalog,
  effortFlagGrammar,
  effortValueGrammar,
  isEffortModifierValue
} from "../efforts"
import { printModels, validateClaudeModel, validateCodexModel } from "./models"

export class ExitError extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`)
  }
}

export const KNOWN_CLAUDE_OPTIN_PLUGINS = ["supabase", "n8n"]

interface ModifierMetadata {
  readonly target: "claude" | "codex"
  readonly ignoredWarning: string
  readonly hasValue: (ctx: Ctx) => boolean
  readonly clear: (ctx: Ctx) => void
}

const MODIFIER_METADATA = {
  "--claude-model": {
    target: "claude",
    ignoredWarning: "--claude-model ignored: claude target not selected",
    hasValue: (ctx) => ctx.claudeModel !== "",
    clear: (ctx) => {
      ctx.claudeModel = ""
    }
  },
  "--claude-effort": {
    target: "claude",
    ignoredWarning: "--claude-effort ignored: claude target not selected",
    hasValue: (ctx) => ctx.claudeEffort !== "",
    clear: (ctx) => {
      ctx.claudeEffort = ""
    }
  },
  "--claude-advisor": {
    target: "claude",
    ignoredWarning: "--claude-advisor ignored: claude target not selected",
    hasValue: (ctx) => ctx.claudeAdvisor !== "",
    clear: (ctx) => {
      ctx.claudeAdvisor = ""
    }
  },
  "--claude-compact-window": {
    target: "claude",
    ignoredWarning: "--claude-compact-window ignored: claude target not selected",
    hasValue: (ctx) => ctx.claudeCompactWindow !== "",
    clear: (ctx) => {
      ctx.claudeCompactWindow = ""
    }
  },
  "--claude-permissive": {
    target: "claude",
    ignoredWarning: "--claude-permissive ignored: claude target not selected",
    hasValue: (ctx) => ctx.claudePermissive,
    clear: (ctx) => {
      ctx.claudePermissive = false
    }
  },
  "--claude-plugin": {
    target: "claude",
    ignoredWarning: "--claude-plugin ignored: claude target not selected",
    hasValue: (ctx) => ctx.claudePlugins.length > 0,
    clear: (ctx) => {
      ctx.claudePlugins = []
    }
  },
  "--codex-model": {
    target: "codex",
    ignoredWarning: "--codex-model ignored: codex target not selected",
    hasValue: (ctx) => ctx.codexModel !== "",
    clear: (ctx) => {
      ctx.codexModel = ""
    }
  },
  "--codex-effort": {
    target: "codex",
    ignoredWarning: "--codex-effort ignored: codex target not selected",
    hasValue: (ctx) => ctx.codexEffort !== "",
    clear: (ctx) => {
      ctx.codexEffort = ""
    }
  }
} satisfies Record<ModifierFlag, ModifierMetadata>

type ScalarModifierFlag =
  | "--claude-model"
  | "--claude-effort"
  | "--claude-advisor"
  | "--codex-model"
  | "--codex-effort"

const SCALAR_MODIFIER_FLAGS: Record<ScalarModifierFlag, true> = {
  "--claude-model": true,
  "--claude-effort": true,
  "--claude-advisor": true,
  "--codex-model": true,
  "--codex-effort": true
}


function usage(ctx: Ctx): void {
  const { echo } = ctx.services.logger
  const argv0 = "docks-kit sync"
  echo(`Usage: ${argv0} [claude] [codex] [agents] [omp] [flags]`)
  echo("")
  echo("Targets (positional; default: this machine's harness selection)")
  echo("  claude            sync the Claude Code SoT")
  echo("  codex             sync the Codex SoT")
  echo("  agents            sync universal agent skills")
  echo("  omp               sync the Oh My Pi SoT")
  echo("")
  echo("Global flags")
  echo("  --dry-run         preview without applying")
  echo(
    "  --reconcile       reconcile kit-owned settings with SoT (SoT keys win; user-only keys preserved; permissions arrays replaced)"
  )
  echo(
    "  --prune           uninstall kit-managed installs not in SoT (plugins, marketplaces, skills in SoT/.agents/skills.txt)"
  )
  echo("  --skip-bubblewrap skip optional bubblewrap bootstrap (Codex Linux sandbox)")
  echo("  --skip-plugin-refresh  install missing plugins but skip refresh-only updates")
  echo("  --verbose         also print no-op confirmations (already in sync, up to date, left as-is)")
  echo("")
  echo("Deploy-time modifiers (deployed config only; SoT untouched; a later flag-less sync reverts)")
  echo(
    "  --claude-model=<m>            set deployed ~/.claude/settings.json model (aliases: best|opus|fable|sonnet|haiku, full claude-* IDs, or 'default' to unset)"
  )
  echo(`  ${effortFlagGrammar("claude").padEnd(39)} set deployed effortLevel`)
  echo(`  ${advisorFlagGrammar().padEnd(39)} set deployed advisor state`)
  echo(
    "  --claude-compact-window=<n>   set deployed autocompact window in tokens (e.g. 680000 or 680k) for disposable sessions"
  )
  echo(
    "  --claude-permissive           empty permissions.ask/deny in deployed settings (sandboxes/containers; unattended commits + pushes)"
  )
  echo("  --codex-model=<m>             set deployed ~/.codex/config.toml model (e.g. gpt-5.5)")
  echo(`  ${effortFlagGrammar("codex").padEnd(39)} set deployed model_reasoning_effort`)
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

export function parseClaudePlugin(name: string, err: (message: string) => void): string {
  if (!KNOWN_CLAUDE_OPTIN_PLUGINS.includes(name)) {
    err(`Unknown opt-in plugin '${name}'. Known: ${KNOWN_CLAUDE_OPTIN_PLUGINS.join(", ")}`)
    throw new ExitError(2)
  }
  return name
}

function markModifier(ctx: Ctx, flag: ModifierFlag): void {
  const flags = ctx.modifierFlags ?? new Set<ModifierFlag>()
  flags.add(flag)
  ctx.modifierFlags = flags
}

function addClaudePlugin(ctx: Ctx, name: string): void {
  if (name === "") {
    printCatalog(
      ctx,
      `Available Claude optional plugins:\n${KNOWN_CLAUDE_OPTIN_PLUGINS.map((plugin) => `  ${plugin}`).join("\n")}`
    )
    ctx.services.logger.err(
      `Invalid Claude plugin '' — valid: ${KNOWN_CLAUDE_OPTIN_PLUGINS.join("|")}`
    )
    throw new ExitError(2)
  }
  ctx.claudePlugins.push(parseClaudePlugin(name, ctx.services.logger.err))
  markModifier(ctx, "--claude-plugin")
}

type TargetFlag = "syncClaude" | "syncCodex" | "syncAgents" | "syncOmp"

const TARGET_FLAGS = {
  claude: "syncClaude",
  codex: "syncCodex",
  agents: "syncAgents",
  omp: "syncOmp"
} satisfies Record<Harness, TargetFlag>

function selectTarget(ctx: Ctx, target: Harness): void {
  ctx[TARGET_FLAGS[target]] = true
  ctx.targetFilterSet = true
}

function applySelection(ctx: Ctx, selection: ReadonlyArray<Harness>): void {
  ctx.syncClaude = selection.includes("claude")
  ctx.syncCodex = selection.includes("codex")
  ctx.syncAgents = selection.includes("agents")
  ctx.syncOmp = selection.includes("omp")
}

function applyDefaultSelection(ctx: Ctx): void {
  if (ctx.targetFilterSet) return

  const storedSelection = readHarnessSelection(ctx.home)
  applySelection(ctx, storedSelection ?? LEGACY_SELECTION)
  if (storedSelection !== undefined || !ctx.interactive) return

  ctx.services.logger.echo("No harness selection stored; syncing claude, codex, agents")
  ctx.services.logger.echo("Choose harnesses with: docks-kit harnesses")
}

function setModifier(ctx: Ctx, flag: ScalarModifierFlag, value: string): void {
  switch (flag) {
    case "--claude-model":
      ctx.claudeModel = value
      break
    case "--claude-effort":
      ctx.claudeEffort = value
      break
    case "--claude-advisor":
      ctx.claudeAdvisor = value
      break
    case "--codex-model":
      ctx.codexModel = value
      break
    case "--codex-effort":
      ctx.codexEffort = value
      break
  }
  markModifier(ctx, flag)
}

function isScalarModifierFlag(value: string): value is ScalarModifierFlag {
  return SCALAR_MODIFIER_FLAGS[value as ScalarModifierFlag] === true
}


export function parseArgs(ctx: Ctx, args: ReadonlyArray<string>): void {
  const { err } = ctx.services.logger
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ""
    if (isScalarModifierFlag(arg) && args[index + 1] === "") {
      setModifier(ctx, arg, "")
      index += 1
      continue
    }
    switch (arg) {
      case "claude":
      case "codex":
      case "agents":
      case "omp":
        selectTarget(ctx, arg)
        continue
      case "--dry-run":
        ctx.dryRun = true
        continue
      case "--skip-bubblewrap":
        ctx.skipBubblewrap = true
        continue
      case "--skip-plugin-refresh":
        ctx.skipPluginRefresh = true
        continue
      case "--reconcile":
        ctx.reconcile = true
        continue
      case "--prune":
        ctx.prune = true
        continue
      case "--verbose":
        ctx.verbose = true
        continue
      case "--claude-model":
        printModels(ctx, "claude")
        err("--claude-model requires a value: --claude-model=<model>")
        throw new ExitError(2)
      case "--codex-model":
        printModels(ctx, "codex")
        err("--codex-model requires a value: --codex-model=<model>")
        throw new ExitError(2)
      case "--claude-effort":
        printCatalog(ctx, effortCatalog("claude"))
        err(`--claude-effort requires a value: ${effortFlagGrammar("claude")}`)
        throw new ExitError(2)
      case "--codex-effort":
        printCatalog(ctx, effortCatalog("codex"))
        err(`--codex-effort requires a value: ${effortFlagGrammar("codex")}`)
        throw new ExitError(2)
      case "--claude-advisor":
        printCatalog(ctx, advisorCatalog())
        err(`--claude-advisor requires a value: ${advisorFlagGrammar()}`)
        throw new ExitError(2)
      case "--claude-compact-window":
        err("--claude-compact-window requires a value: --claude-compact-window=<tokens> (e.g. 680k)")
        throw new ExitError(2)
      case "--claude-permissive":
        ctx.claudePermissive = true
        markModifier(ctx, "--claude-permissive")
        continue
      case "--claude-plugin":
        err(`--claude-plugin requires a value: --claude-plugin=<${KNOWN_CLAUDE_OPTIN_PLUGINS.join("|")}>`)
        throw new ExitError(2)
      case "--claude":
      case "--codex":
      case "--agents":
      case "--omp":
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
      case "--skip-rtk":
        err("--skip-rtk was renamed to --skip-bubblewrap")
        throw new ExitError(2)
      case "-h":
      case "--help":
        usage(ctx)
        throw new ExitError(0)
      default:
        break
    }
    if (arg.startsWith("--claude-model=")) {
      setModifier(ctx, "--claude-model", arg.slice("--claude-model=".length))
    } else if (arg.startsWith("--codex-model=")) {
      setModifier(ctx, "--codex-model", arg.slice("--codex-model=".length))
    } else if (arg.startsWith("--claude-effort=")) {
      setModifier(ctx, "--claude-effort", arg.slice("--claude-effort=".length))
    } else if (arg.startsWith("--codex-effort=")) {
      setModifier(ctx, "--codex-effort", arg.slice("--codex-effort=".length))
    } else if (arg.startsWith("--claude-advisor=")) {
      setModifier(ctx, "--claude-advisor", arg.slice("--claude-advisor=".length))
    } else if (arg.startsWith("--claude-compact-window=")) {
      const parsed = parseCompactWindow(arg.slice("--claude-compact-window=".length))
      if (parsed === undefined) {
        err("--claude-compact-window expects a token count (e.g. 680000 or 680k)")
        throw new ExitError(2)
      }
      ctx.claudeCompactWindow = parsed
      markModifier(ctx, "--claude-compact-window")
    } else if (arg.startsWith("--claude-plugin=")) {
      addClaudePlugin(ctx, arg.slice("--claude-plugin=".length))
    } else if (arg.startsWith("--claude-permissive=")) {
      err("--claude-permissive does not take a value")
      throw new ExitError(2)
    } else {
      err(`Unknown arg: ${arg}`)
      throw new ExitError(2)
    }
  }

  applyDefaultSelection(ctx)
}

function printCatalog(ctx: Ctx, catalog: string): void {
  for (const line of catalog.split("\n")) ctx.services.logger.echo(line)
}


export function validateModifierFlags(ctx: Ctx): void {
  const { err, warn } = ctx.services.logger
  const supplied = (flag: ModifierFlag): boolean =>
    MODIFIER_METADATA[flag].hasValue(ctx) || ctx.modifierFlags?.has(flag) === true

  for (const flag of Object.keys(MODIFIER_METADATA) as Array<ModifierFlag>) {
    const metadata = MODIFIER_METADATA[flag]
    const targetSelected = metadata.target === "claude" ? ctx.syncClaude : ctx.syncCodex
    if (!targetSelected && supplied(flag)) {
      warn(metadata.ignoredWarning)
      metadata.clear(ctx)
      ctx.modifierFlags?.delete(flag)
    }
  }

  if (supplied("--claude-model")) {
    if (!validateClaudeModel(ctx, ctx.claudeModel)) {
      printModels(ctx, "claude")
      err(`Invalid Claude model '${ctx.claudeModel}' — use an alias above or a full claude-* ID`)
      throw new ExitError(2)
    }
  }
  if (supplied("--claude-effort")) {
    if (!isEffortModifierValue("claude", ctx.claudeEffort)) {
      printCatalog(ctx, effortCatalog("claude"))
      err(`Invalid Claude effort '${ctx.claudeEffort}' — valid: ${effortValueGrammar("claude")}`)
      throw new ExitError(2)
    }
  }
  if (supplied("--claude-advisor")) {
    if (!CLAUDE_ADVISOR_STATES.some((state) => state === ctx.claudeAdvisor)) {
      printCatalog(ctx, advisorCatalog())
      err(`Invalid Claude advisor state '${ctx.claudeAdvisor}' — valid: ${advisorValueGrammar()}`)
      throw new ExitError(2)
    }
  }
  if (supplied("--codex-model")) {
    if (!validateCodexModel(ctx, ctx.codexModel)) {
      printModels(ctx, "codex")
      err(`Invalid Codex model '${ctx.codexModel}' — must match ^[A-Za-z0-9._-]+$`)
      throw new ExitError(2)
    }
  }
  if (supplied("--codex-effort")) {
    if (!isEffortModifierValue("codex", ctx.codexEffort)) {
      printCatalog(ctx, effortCatalog("codex"))
      err(`Invalid Codex effort '${ctx.codexEffort}' — valid: ${effortValueGrammar("codex")}`)
      throw new ExitError(2)
    }
  }
}
