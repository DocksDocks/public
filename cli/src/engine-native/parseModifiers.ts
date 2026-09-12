/**
 * Modifier and effort mapping for the EngineNative flag layer: deploy-time
 * modifier metadata, scalar-modifier setters, compact-window and opt-in
 * plugin parsing, and post-parse modifier validation. Pure apart from the
 * injected ctx seam; help output and the early-exit error come from
 * parseHelp.ts.
 */

import type { Ctx, ModifierFlag } from "./index"
import type { ScalarModifierFlag } from "./sharedTypes"
import {
  CLAUDE_ADVISOR_STATES,
  advisorCatalog,
  advisorValueGrammar,
  effortCatalog,
  effortValueGrammar,
  isEffortModifierValue
} from "../efforts"
import { printModels, validateClaudeModel, validateCodexModel } from "./models"
import { ExitError, printCatalog } from "./parseHelp"

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

export type { ScalarModifierFlag };

const SCALAR_MODIFIER_FLAGS: Record<ScalarModifierFlag, true> = {
  "--claude-model": true,
  "--claude-effort": true,
  "--claude-advisor": true,
  "--codex-model": true,
  "--codex-effort": true
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

export function markModifier(ctx: Ctx, flag: ModifierFlag): void {
  const flags = ctx.modifierFlags ?? new Set<ModifierFlag>()
  flags.add(flag)
  ctx.modifierFlags = flags
}

export function addClaudePlugin(ctx: Ctx, name: string): void {
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

export function setModifier(ctx: Ctx, flag: ScalarModifierFlag, value: string): void {
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

export function isScalarModifierFlag(value: string): value is ScalarModifierFlag {
  return SCALAR_MODIFIER_FLAGS[value as ScalarModifierFlag] === true
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
