/**
 * Port of codex::_replace_top_level_setting + codex::sync_model
 * (lib/codex.sh). The awk pass is line-based on purpose — a TOML library
 * would reformat user configs and break parity; this port replicates the awk
 * program record-for-record, including its quirks (the key is used as a raw
 * regex fragment, exactly like awk's `"^" key "[[:space:]]*="`).
 */
import { p } from "./exec"
import { readFileSync, renameSync, writeFileSync } from "node:fs"

import type { Ctx } from "./index"
import { echo, log, warn } from "./output"

export function replaceTopLevelSetting(content: string, key: string, replacement: string): string {
  const lines = content.split("\n")
  if (lines[lines.length - 1] === "") lines.pop() // awk records exclude a trailing empty split artifact
  const keyRe = new RegExp(`^${key}[ \\t]*=`)
  const out: Array<string> = []
  let inTable = false
  let replaced = false
  for (const line of lines) {
    if (line.startsWith("[")) {
      if (!replaced) {
        out.push(replacement)
        replaced = true
      }
      inTable = true
      out.push(line)
      continue
    }
    if (!inTable && keyRe.test(line)) {
      if (!replaced) {
        out.push(replacement)
        replaced = true
      }
      continue
    }
    out.push(line)
  }
  if (!replaced) out.push(replacement)
  return `${out.join("\n")}\n`
}

export function replaceTopLevelSettingInFile(file: string, key: string, replacement: string): void {
  const next = replaceTopLevelSetting(readFileSync(file, "utf8"), key, replacement)
  writeFileSync(`${file}.tmp`, next)
  renameSync(`${file}.tmp`, file)
}

export function syncCodexModel(ctx: Ctx, model: string): void {
  const userCodexSettings = p(ctx.home, ".codex", "config.toml")

  if (model === "") return

  if (ctx.dryRun) {
    echo(`[dry-run] (--codex-model) set model = "${model}" in ${userCodexSettings}`)
    return
  }

  try {
    readFileSync(userCodexSettings)
  } catch {
    warn(`(--codex-model) ${userCodexSettings} missing — skipped`)
    return
  }
  replaceTopLevelSettingInFile(userCodexSettings, "model", `model = "${model}"`)
  log(`Model: deployed Codex model set to ${model} (SoT unchanged; flag-less sync reverts)`)
}
