/**
 * EngineNative Codex retired-hook pruning. Removes only the Claude hooks
 * docks-kit retired before Codex could import them safely. Guard order,
 * message strings, and backup behavior are golden-tested.
 */
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"

import { p } from "./exec"
import type { Ctx } from "./index"
import { isObject, jqStringify, parseJson, type Json } from "./jq"

const RETIRED_CONTEXT_HOOK = `echo "[CONTEXT] Current date: $(date '+%A, %Y-%m-%d %H:%M:%S %Z')"`
const RETIRED_SKILLS_HOOK = `SKILL_COUNT=$(find .claude/skills -name 'SKILL.md' -mindepth 2 -maxdepth 2 2>/dev/null | wc -l); [ "$SKILL_COUNT" -gt 0 ] && echo "[SKILLS] $SKILL_COUNT project skills available in .claude/skills/. Claude Code loads them on demand via Skill tool. After code changes affecting documented patterns, update the relevant skill and its metadata.updated field." || true`
const RETIRED_CONFIG_HOOKS = new Set([
  `echo "[CONFIG] Context: $([ \\"\${CLAUDE_CODE_DISABLE_1M_CONTEXT:-0}\\" = \\"1\\" ] && echo '200K' || echo '1M') | Compact-window: \${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-full} | Effort: \${CLAUDE_CODE_EFFORT_LEVEL:-high} | Thinking: adaptive | Subagent: \${CLAUDE_CODE_SUBAGENT_MODEL:-default}"`,
  `echo "[CONFIG] Context: $([ \\"\${CLAUDE_CODE_DISABLE_1M_CONTEXT:-0}\\" = \\"1\\" ] && echo '200K' || echo '1M') | Compact-window: \${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-full} | Effort: \${CLAUDE_CODE_EFFORT_LEVEL:-high} | Thinking: adaptive | Model: \${ANTHROPIC_DEFAULT_OPUS_MODEL:-default} | Subagent: \${CLAUDE_CODE_SUBAGENT_MODEL:-default}"`,
  `echo "[CONFIG] Context: $([ \\"\${CLAUDE_CODE_DISABLE_1M_CONTEXT:-0}\\" = \\"1\\" ] && echo '200K' || echo '1M') | Compact-window: \${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-full} | Effort: \${CLAUDE_CODE_EFFORT_LEVEL:-$(jq -r .effortLevel $HOME/.claude/settings.json 2>/dev/null || echo default)} | Thinking: adaptive | Subagent: \${CLAUDE_CODE_SUBAGENT_MODEL:-default}"`
])

function isRetiredImportedSessionStartHook(handler: Json, codexDir: string): boolean {
  if (!isObject(handler) || handler["type"] !== "command" || typeof handler["command"] !== "string") return false
  const command = handler["command"]
  const connectorScript = p(codexDir, "hooks", "disable-claudeai-connectors.sh")
  const retiredConnectorHook = `[ -x '${connectorScript}' ] && '${connectorScript}' || true`
  return command === RETIRED_CONTEXT_HOOK || command === RETIRED_SKILLS_HOOK || RETIRED_CONFIG_HOOKS.has(command) || command === retiredConnectorHook
}

function withoutRetiredImportedHooks(doc: { [key: string]: Json }, codexDir: string): { readonly value: Json; readonly removed: number } {
  const hooks = doc["hooks"]
  if (!isObject(hooks) || !Array.isArray(hooks["SessionStart"])) return { value: doc, removed: 0 }

  let removed = 0
  const groups: Array<Json> = []
  for (const group of hooks["SessionStart"]) {
    if (!isObject(group) || !Array.isArray(group["hooks"])) {
      groups.push(group)
      continue
    }
    const kept = group["hooks"].filter((handler) => {
      if (!isRetiredImportedSessionStartHook(handler, codexDir)) return true
      removed++
      return false
    })
    if (kept.length > 0) groups.push({ ...group, hooks: kept })
  }
  if (removed === 0) return { value: doc, removed: 0 }

  const nextHooks = { ...hooks }
  if (groups.length > 0) nextHooks["SessionStart"] = groups
  else delete nextHooks["SessionStart"]
  return { value: { ...doc, hooks: nextHooks }, removed }
}

/** Remove only Claude hooks that docks-kit retired before Codex could import them safely. */
export function removeRetiredImportedHooks(ctx: Ctx, codexDir: string): void {
  const { change, echo, warn } = ctx.services.logger
  const hooksFile = p(codexDir, "hooks.json")
  if (!existsSync(hooksFile)) return
  const before = readFileSync(hooksFile, "utf8")
  const doc = parseJson(before)
  if (doc === undefined || !isObject(doc)) {
    warn(`Codex hooks file is not a valid JSON object; retired hook cleanup skipped: ${hooksFile}`)
    return
  }
  const result = withoutRetiredImportedHooks(doc, codexDir)
  if (result.removed === 0) return

  if (ctx.dryRun) {
    echo(`[dry-run] remove ${result.removed} retired imported docks-kit SessionStart hook(s) from ${hooksFile}`)
    return
  }

  copyFileSync(hooksFile, `${hooksFile}.bak`)
  writeFileSync(`${hooksFile}.tmp`, jqStringify(result.value))
  renameSync(`${hooksFile}.tmp`, hooksFile)
  change(`Codex: removed ${result.removed} retired imported docks-kit SessionStart hook(s) (backup at hooks.json.bak)`)
  ctx.nextStepTriggers.codexRestart = true
}

