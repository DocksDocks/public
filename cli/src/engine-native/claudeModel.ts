/**
 * --claude-model deploy-time modifier, shared with the `model claude <value>`
 * direct mode.
 */
import { p } from "./exec"
import { readFileSync, renameSync, writeFileSync } from "node:fs"

import type { Ctx } from "./index"
import { isObject, jqStringify, parseJson } from "./jq"
import { change, echo, err, verbose, warn } from "./logger"

export function syncClaudeModel(ctx: Ctx, model: string): void {
  const userSettings = p(ctx.home, ".claude", "settings.json")

  if (model === "") return

  if (ctx.dryRun) {
    if (model === "default") {
      echo(`[dry-run] (--claude-model) delete .model in ${userSettings} (account default applies)`)
    } else {
      echo(`[dry-run] (--claude-model) set .model=${model} in ${userSettings}`)
    }
    return
  }

  let text: string
  try {
    text = readFileSync(userSettings, "utf8")
  } catch {
    warn(`(--claude-model) ${userSettings} missing — skipped`)
    return
  }
  const doc = parseJson(text)
  if (doc === undefined) {
    err(`(--claude-model) ${userSettings} is not valid JSON — skipped`)
    return
  }
  if (isObject(doc)) {
    if (model === "default") {
      delete doc["model"]
    } else {
      doc["model"] = model
    }
  }
  const out = jqStringify(doc)
  if (out === text) {
    verbose(`Model: deployed settings model already ${model === "default" ? "unset (account default)" : model}`)
    return
  }
  writeFileSync(`${userSettings}.tmp`, out)
  renameSync(`${userSettings}.tmp`, userSettings)
  change(`Model: deployed settings model set to ${model} (SoT unchanged; flag-less sync reverts)`)
  ctx.nextStepTriggers.claudeRestart = true
}
