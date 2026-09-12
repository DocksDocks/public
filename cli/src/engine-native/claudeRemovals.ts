/**
 * EngineNative `sync claude` retired-artifact pruning. The SoT no longer
 * ships the inventoried rules and artifacts, so this pass force-prunes them
 * from existing installations without `--reconcile`. Message strings and
 * prune semantics are part of the contract.
 */
import { existsSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs"
import type { ClaudeRuntimeState } from "./claudeSync"
import { RETIRED_PERMISSION_RULES } from "./claudeRetired"
import { p } from "./exec"
import type { Ctx } from "./index"
import { isObject, jqStringify, parseJson, type Json } from "./jq"

const REMOVED_MANIFEST = {
  hooks: ["disable-claudeai-connectors.sh"],
  files: ["alert_bubble.mp3"],
  settingsKeys: [
    "showTurnDuration",
    "advisorModel",
    "env.CLAUDE_CODE_SUBAGENT_MODEL",
    "env.ANTHROPIC_DEFAULT_OPUS_MODEL",
    "env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE",
    "env.CLAUDE_CODE_DISABLE_1M_CONTEXT",
    "env.CLAUDE_CODE_FORK_SUBAGENT",
    "env.CLAUDE_CODE_EFFORT_LEVEL",
    "enabledPlugins.effect-kit@docks",
    "enabledPlugins.session-relay@docks",
    "hooks.PreToolUse"
  ],
  permissionRules: {
    allow: ["Write(./)", "Bash(rtk *)", ...RETIRED_PERMISSION_RULES.allow],
    deny: [
      "Write(**/.env)",
      "Write(**/.env.local)",
      "Write(**/secrets/**)",
      ...RETIRED_PERMISSION_RULES.deny
    ],
    ask: [...RETIRED_PERMISSION_RULES.ask]
  },
  claudeJsonKeys: [] as Array<string>,
  /** Home-relative artifacts the kit installed outside ~/.claude. */
  homeFiles: [".local/bin/effect-solutions", ".local/bin/session-relay"],
  runtimeReady: {
    hooks: ["notify.sh"],
    files: ["statusline.sh", "fetch-usage.sh"],
    settingsKeys: ["hooks.Stop"]
  }
}

/** claude::_prune_json_keys — present-count; deletes when !dryRun. */
function pruneJsonKeys(ctx: Ctx, file: string, keys: Array<string>): number {
  if (keys.length === 0 || !existsSync(file)) return 0
  const doc = parseJson(readFileSync(file, "utf8"))
  if (doc === undefined) return 0

  const hasPath = (root: Json, path: Array<string>): boolean => {
    let cur: Json = root
    for (const seg of path.slice(0, -1)) {
      if (!isObject(cur) || cur[seg] === undefined) return false
      cur = cur[seg]!
    }
    return isObject(cur) && Object.prototype.hasOwnProperty.call(cur, path[path.length - 1]!)
  }
  const presentKeys = keys.filter((k) => hasPath(doc, k.split(".")))
  if (presentKeys.length === 0) return 0

  if (!ctx.dryRun) {
    for (const k of presentKeys) {
      const path = k.split(".")
      let cur: Json = doc
      for (const seg of path.slice(0, -1)) {
        if (!isObject(cur)) break
        cur = cur[seg]!
      }
      if (isObject(cur)) delete cur[path[path.length - 1]!]
    }
    writeFileSync(`${file}.tmp`, jqStringify(doc))
    renameSync(`${file}.tmp`, file)
  }
  return presentKeys.length
}

function prunePermissionRules(
  ctx: Ctx,
  file: string,
  rules: Readonly<Record<"allow" | "deny" | "ask", ReadonlyArray<string>>>
): number {
  if (!existsSync(file)) return 0
  const doc = parseJson(readFileSync(file, "utf8"))
  if (doc === undefined || !isObject(doc) || !isObject(doc["permissions"])) return 0
  const permissions = doc["permissions"]
  let present = 0
  for (const key of ["allow", "deny", "ask"] as const) {
    const values = permissions[key]
    if (!Array.isArray(values)) continue
    const removed = new Set(rules[key])
    present += rules[key].filter((rule) => values.includes(rule)).length
    if (!ctx.dryRun) permissions[key] = values.filter((value) => typeof value !== "string" || !removed.has(value))
  }
  if (present > 0 && !ctx.dryRun) {
    writeFileSync(`${file}.tmp`, jqStringify(doc))
    renameSync(`${file}.tmp`, file)
  }
  return present
}

export function syncRemovals(ctx: Ctx, claudeDir: string, runtime: ClaudeRuntimeState): void {
  const { change, echo } = ctx.services.logger
  let hooksRemoved = 0
  let filesRemoved = 0
  const hooks = [
    ...REMOVED_MANIFEST.hooks,
    ...(runtime.kind === "ready" ? REMOVED_MANIFEST.runtimeReady.hooks : [])
  ]
  const files = [
    ...REMOVED_MANIFEST.files,
    ...(runtime.kind === "ready" ? REMOVED_MANIFEST.runtimeReady.files : [])
  ]
  const settingsKeys = [
    ...REMOVED_MANIFEST.settingsKeys.filter((key) => key !== "advisorModel" || ctx.claudeAdvisor === ""),
    ...(runtime.kind === "ready" ? REMOVED_MANIFEST.runtimeReady.settingsKeys : [])
  ]

  for (const name of hooks) {
    const path = p(claudeDir, "hooks", name)
    if (!existsSync(path)) continue
    if (ctx.dryRun) {
      echo(`[dry-run] rm ${path}`)
    } else {
      rmSync(path, { force: true })
      hooksRemoved++
    }
  }
  if (!ctx.dryRun && hooksRemoved > 0) {
    try {
      rmdirSync(p(claudeDir, "hooks"))
    } catch {
      // Preserve a non-empty user hooks directory.
    }
  }

  for (const rel of files) {
    const path = p(claudeDir, rel)
    if (!existsSync(path)) continue
    if (ctx.dryRun) {
      echo(`[dry-run] rm ${path}`)
    } else {
      rmSync(path, { force: true })
      filesRemoved++
    }
  }

  for (const rel of REMOVED_MANIFEST.homeFiles) {
    const path = p(ctx.home, rel)
    if (!existsSync(path)) continue
    if (ctx.dryRun) {
      echo(`[dry-run] rm ${path}`)
    } else {
      rmSync(path, { force: true })
      filesRemoved++
    }
  }

  const skeys = pruneJsonKeys(ctx, p(claudeDir, "settings.json"), settingsKeys)
  const permissionRules = prunePermissionRules(
    ctx,
    p(claudeDir, "settings.json"),
    REMOVED_MANIFEST.permissionRules
  )
  const cjkeys = pruneJsonKeys(ctx, p(ctx.home, ".claude.json"), REMOVED_MANIFEST.claudeJsonKeys)

  if (ctx.dryRun) {
    if (skeys > 0) echo(`[dry-run] del ${skeys} stale key(s) from ${p(claudeDir, "settings.json")}`)
    if (permissionRules > 0) {
      echo(`[dry-run] del ${permissionRules} stale permission rule(s) from ${p(claudeDir, "settings.json")}`)
    }
    if (cjkeys > 0) echo(`[dry-run] del ${cjkeys} stale key(s) from ${p(ctx.home, ".claude.json")}`)
    return
  }

  if (hooksRemoved + filesRemoved + skeys + permissionRules + cjkeys > 0) {
    const permissionSummary = permissionRules > 0 ? `, permission rules: ${permissionRules}` : ""
    change(`Pruned stale artifacts (hooks: ${hooksRemoved}, files: ${filesRemoved}, settings keys: ${skeys}, claude.json keys: ${cjkeys}${permissionSummary})`)
    ctx.nextStepTriggers.claudeRestart = true
  }
}
