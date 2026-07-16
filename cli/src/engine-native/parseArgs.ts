/**
 * EngineNative flag layer: usage / target selection / compact-window parsing /
 * optional-plugin parsing / model validation. ExitError mirrors an
 * early parser exit and is caught once in runEngineNative.
 */

import type { Ctx, ModifierFlag } from "./index"
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
import {
  buildWorkflowRecord,
  workflowCatalog,
  type WorkflowOverrides
} from "../workflowModels"

export class ExitError extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`)
  }
}

const KNOWN_CLAUDE_OPTIN_PLUGINS = ["supabase", "n8n"]
const MODIFIER_FLAGS = new Set<ModifierFlag>([
  "--claude-model",
  "--claude-effort",
  "--claude-advisor",
  "--codex-model",
  "--codex-effort"
])

function usage(ctx: Ctx): void {
  const { echo } = ctx.services.logger
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
  echo("  --skip-plugin-refresh  install missing plugins but skip refresh-only updates")
  echo("  --yes             auto-accept toolchain prompts (containers/CI)")
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

function addClaudePlugin(ctx: Ctx, name: string): void {
  const { err } = ctx.services.logger
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

function setModifier(ctx: Ctx, flag: ModifierFlag, value: string): void {
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
  const flags = ctx.modifierFlags ?? new Set<ModifierFlag>()
  flags.add(flag)
  ctx.modifierFlags = flags
}

function isModifierFlag(value: string): value is ModifierFlag {
  return MODIFIER_FLAGS.has(value as ModifierFlag)
}

export function parseArgs(ctx: Ctx, args: ReadonlyArray<string>): void {
  const { err } = ctx.services.logger
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ""
    if (isModifierFlag(arg) && args[index + 1] === "") {
      setModifier(ctx, arg, "")
      index += 1
      continue
    }
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
      case "--skip-plugin-refresh":
        ctx.skipPluginRefresh = true
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

function printCatalog(ctx: Ctx, catalog: string): void {
  for (const line of catalog.split("\n")) ctx.services.logger.echo(line)
}

const WORKFLOW_FLAGS = {
  "--model-orchestrator": "orchestrator",
  "--model-reviewer": "reviewer",
  "--model-implementer": "implementer",
  "--review-min-score": "minimumScore",
  "--review-max-rounds": "maxRounds"
} as const satisfies Readonly<Record<string, keyof WorkflowOverrides>>

function workflowUsage(ctx: Ctx): void {
  printCatalog(ctx, workflowCatalog())
  ctx.services.logger.echo("")
  ctx.services.logger.echo("Workflow override flags:")
  ctx.services.logger.echo("  --model-orchestrator=<profile:name|tool:model@effort>")
  ctx.services.logger.echo("  --model-reviewer=<profile:name|tool:model@effort>")
  ctx.services.logger.echo("  --model-implementer=<profile:name|tool:model@effort>")
  ctx.services.logger.echo("  --review-min-score=<0..100>")
  ctx.services.logger.echo("  --review-max-rounds=<1..10>")
}

export function parseWorkflowArgs(ctx: Ctx, args: ReadonlyArray<string>): WorkflowOverrides {
  const overrides: Partial<Record<keyof WorkflowOverrides, string>> = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ""
    if (arg === "-h" || arg === "--help") {
      workflowUsage(ctx)
      throw new ExitError(0)
    }

    const equals = arg.indexOf("=")
    const flag = equals === -1 ? arg : arg.slice(0, equals)
    const key = WORKFLOW_FLAGS[flag as keyof typeof WORKFLOW_FLAGS]
    if (key === undefined) throw new Error(`Unknown workflow arg: ${arg}`)

    let value: string
    if (equals !== -1) {
      value = arg.slice(equals + 1)
    } else {
      const next = args[index + 1]
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`${flag} requires a value: ${flag}=<value>`)
      }
      value = next
      index += 1
    }
    if (value === "") throw new Error(`${flag} requires a value: ${flag}=<value>`)
    overrides[key] = value
  }

  if (Object.keys(overrides).length === 0) {
    throw new Error("At least one workflow override flag is required")
  }
  buildWorkflowRecord(overrides)
  return overrides
}

export function printWorkflowUsage(ctx: Ctx): void {
  workflowUsage(ctx)
}

export function validateModifierFlags(ctx: Ctx): void {
  const { err, warn } = ctx.services.logger
  const supplied = (flag: ModifierFlag, value: string): boolean =>
    value !== "" || ctx.modifierFlags?.has(flag) === true
  if (supplied("--claude-model", ctx.claudeModel)) {
    if (!ctx.syncClaude) {
      warn("--claude-model ignored: claude target not selected")
      ctx.claudeModel = ""
    } else if (!validateClaudeModel(ctx, ctx.claudeModel)) {
      printModels(ctx, "claude")
      err(`Invalid Claude model '${ctx.claudeModel}' — use an alias above or a full claude-* ID`)
      throw new ExitError(2)
    }
  }
  if (supplied("--claude-effort", ctx.claudeEffort)) {
    if (!ctx.syncClaude) {
      warn("--claude-effort ignored: claude target not selected")
      ctx.claudeEffort = ""
    } else if (!isEffortModifierValue("claude", ctx.claudeEffort)) {
      printCatalog(ctx, effortCatalog("claude"))
      err(`Invalid Claude effort '${ctx.claudeEffort}' — valid: ${effortValueGrammar("claude")}`)
      throw new ExitError(2)
    }
  }
  if (supplied("--claude-advisor", ctx.claudeAdvisor)) {
    if (!ctx.syncClaude) {
      warn("--claude-advisor ignored: claude target not selected")
      ctx.claudeAdvisor = ""
    } else if (!CLAUDE_ADVISOR_STATES.some((state) => state === ctx.claudeAdvisor)) {
      printCatalog(ctx, advisorCatalog())
      err(`Invalid Claude advisor state '${ctx.claudeAdvisor}' — valid: ${advisorValueGrammar()}`)
      throw new ExitError(2)
    }
  }
  if (supplied("--codex-model", ctx.codexModel)) {
    if (!ctx.syncCodex) {
      warn("--codex-model ignored: codex target not selected")
      ctx.codexModel = ""
    } else if (!validateCodexModel(ctx, ctx.codexModel)) {
      printModels(ctx, "codex")
      err(`Invalid Codex model '${ctx.codexModel}' — must match ^[A-Za-z0-9._-]+$`)
      throw new ExitError(2)
    }
  }
  if (supplied("--codex-effort", ctx.codexEffort)) {
    if (!ctx.syncCodex) {
      warn("--codex-effort ignored: codex target not selected")
      ctx.codexEffort = ""
    } else if (!isEffortModifierValue("codex", ctx.codexEffort)) {
      printCatalog(ctx, effortCatalog("codex"))
      err(`Invalid Codex effort '${ctx.codexEffort}' — valid: ${effortValueGrammar("codex")}`)
      throw new ExitError(2)
    }
  }
}
