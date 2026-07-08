/**
 * Port of claude::sync_model (lib/claude.sh) — the --claude-model deploy-time
 * modifier, shared with the `model claude <value>` direct mode.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Ctx } from "./index"
import { isObject, jqStringify, parseJson } from "./jq"
import { echo, err, log, warn } from "./output"

export function syncClaudeModel(ctx: Ctx, model: string): void {
  const userSettings = join(ctx.home, ".claude", "settings.json")

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
  writeFileSync(`${userSettings}.tmp`, jqStringify(doc))
  renameSync(`${userSettings}.tmp`, userSettings)
  log(`Model: deployed settings model set to ${model} (SoT unchanged; flag-less sync reverts)`)
}
