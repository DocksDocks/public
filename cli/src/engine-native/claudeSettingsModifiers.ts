/** Atomic top-level Claude settings modifiers, including direct model mode. */
import { p } from "./exec"
import { readFileSync, renameSync, writeFileSync } from "node:fs"

import { resolveEffort } from "../efforts"
import type { Ctx } from "./index"
import { isObject, jqStringify, parseJson } from "./jq"

interface ClaudeSettingEdit {
  readonly tag: string
  readonly key: "model" | "effortLevel" | "advisorModel"
  readonly value: string | undefined
  readonly dryRun: string
  readonly changed: string
  readonly unchanged: string
}

function syncClaudeSetting(ctx: Ctx, edit: ClaudeSettingEdit): void {
  const { change, echo, err, verbose, warn } = ctx.services.logger
  const userSettings = p(ctx.home, ".claude", "settings.json")

  if (ctx.dryRun) {
    echo(`[dry-run] (${edit.tag}) ${edit.dryRun} in ${userSettings}`)
    return
  }

  let text: string
  try {
    text = readFileSync(userSettings, "utf8")
  } catch {
    warn(`(${edit.tag}) ${userSettings} missing — skipped`)
    return
  }
  const doc = parseJson(text)
  if (doc === undefined) {
    err(`(${edit.tag}) ${userSettings} is not valid JSON — skipped`)
    return
  }
  if (isObject(doc)) {
    if (edit.value === undefined) delete doc[edit.key]
    else doc[edit.key] = edit.value
  }
  const out = jqStringify(doc)
  if (out === text) {
    verbose(edit.unchanged)
    return
  }
  writeFileSync(`${userSettings}.tmp`, out)
  renameSync(`${userSettings}.tmp`, userSettings)
  change(edit.changed)
  ctx.nextStepTriggers.claudeRestart = true
}

export function syncClaudeModel(ctx: Ctx, model: string): void {
  if (model === "") return
  const unset = model === "default"
  syncClaudeSetting(ctx, {
    tag: "--claude-model",
    key: "model",
    value: unset ? undefined : model,
    dryRun: unset ? "delete .model (account default applies)" : `set .model=${model}`,
    changed: `Model: deployed settings model set to ${model} (SoT unchanged; flag-less sync reverts)`,
    unchanged: `Model: deployed settings model already ${unset ? "unset (account default)" : model}`
  })
}

export function syncClaudeEffort(ctx: Ctx, effort: string): void {
  if (effort === "") return
  const resolved = resolveEffort("claude", effort)
  const useDefault = effort === "default"
  syncClaudeSetting(ctx, {
    tag: "--claude-effort",
    key: "effortLevel",
    value: resolved,
    dryRun: `set .effortLevel=${resolved}`,
    changed: useDefault
      ? `Effort: deployed settings effortLevel set to ${resolved} (SoT default)`
      : `Effort: deployed settings effortLevel set to ${resolved} (SoT unchanged; flag-less sync reverts)`,
    unchanged: `Effort: deployed settings effortLevel already ${resolved}`
  })
}

export function syncClaudeAdvisor(ctx: Ctx, state: string): void {
  if (state === "") return
  const enabled = state === "on"
  const useDefault = state === "default"
  syncClaudeSetting(ctx, {
    tag: "--claude-advisor",
    key: "advisorModel",
    value: enabled ? "fable" : undefined,
    dryRun: enabled ? "set .advisorModel=fable" : "delete .advisorModel (advisor disabled)",
    changed: enabled
      ? "Advisor: deployed settings advisorModel set to fable (SoT unchanged; flag-less sync reverts)"
      : useDefault
        ? "Advisor: deployed settings advisorModel unset (SoT default: off)"
        : "Advisor: deployed settings advisorModel unset (--claude-advisor=off; SoT unchanged)",
    unchanged: enabled
      ? "Advisor: deployed settings advisorModel already fable"
      : `Advisor: deployed settings advisorModel already unset (${useDefault ? "SoT default: off" : "advisor off"})`
  })
}
