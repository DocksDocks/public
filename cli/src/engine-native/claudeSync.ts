/**
 * EngineNative `sync claude` pipeline. Step order is load-bearing: the Bun
 * bootstrap BEFORE the settings merge, modifiers after it, removals before
 * plugins. Message strings, guard order, JSON semantics, and spawned argv are
 * golden-tested.
 */
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { bunBootstrap } from "./bun"
import {
  syncClaudeAdvisor,
  syncClaudeEffort,
  syncClaudeModel
} from "./claudeSettingsModifiers"
import { claudeRuntimePaths, materializeClaudeSettings, type ClaudeRuntimePaths } from "./claudeRuntime"
import { syncLspServers, syncOptionalPlugins, syncPlugins } from "./claudePlugins"
import { RETIRED_PERMISSION_RULES } from "./claudeRetired"
import { p, spawnProcess, writeBytesIfChanged, writeTextIfChanged } from "./exec"
import type { Ctx } from "./index"
import { deepMerge, isObject, jqStringify, parseJson, readJsonFile, type Json } from "./jq"
import { ExitError } from "./parseArgs"
import { hostOs } from "./os"
import { mergeSettings, reconcileSettings } from "./settings"
import { payloadBytes, payloadDisplayPath, payloadText } from "../payload"

export type ClaudeRuntimeState =
  | { readonly kind: "ready"; readonly paths: ClaudeRuntimePaths }
  | { readonly kind: "deferred"; readonly reason: "bun-unavailable" }

export async function claudeSync(ctx: Ctx): Promise<ClaudeRuntimeState> {
  const { err, warn } = ctx.services.logger
  const claudeDir = p(ctx.home, ".claude")

  if (!ctx.dryRun) mkdirSync(claudeDir, { recursive: true })

  if (ctx.services.deps.probe("claude").state === "missing") {
    warn(
      `claude CLI not found - config deploys, but plugin passes are skipped. Install Claude Code: ${ctx.services.deps.spec("claude").installHint()} | docs: https://code.claude.com/docs/en/setup`
    )
  }

  const bun = await bunBootstrap(ctx, ctx.services)
  const runtime: ClaudeRuntimeState = bun.kind === "ready"
    ? { kind: "ready", paths: claudeRuntimePaths(claudeDir, bun.executable) }
    : { kind: "deferred", reason: "bun-unavailable" }
  const template = parseJson(payloadText("SoT/.claude/settings.json"))
  if (template === undefined) {
    err("Embedded SoT/.claude/settings.json is not valid JSON")
    throw new ExitError(1)
  }
  const materialized = materializeClaudeSettings(
    template,
    runtime.kind === "ready" ? runtime.paths : undefined
  )
  const prepared = prepareClaudeSettings(ctx, claudeDir, materialized)

  syncClaudeRuntime(ctx, runtime)
  syncClaudeMd(ctx, claudeDir)
  if (ctx.dryRun) {
    describeSettingsSync(ctx, claudeDir)
  } else {
    commitClaudeSettings(ctx, prepared)
  }
  syncRemovals(ctx, claudeDir, runtime)
  syncCompactWindow(ctx, claudeDir)
  syncPermissive(ctx, claudeDir)
  syncClaudeModel(ctx, ctx.claudeModel)
  syncClaudeEffort(ctx, ctx.claudeEffort)
  syncClaudeAdvisor(ctx, ctx.claudeAdvisor)
  syncClaudeJson(ctx)
  await syncConnectorEnv(ctx)
  await syncPlugins(ctx, claudeDir)
  await syncOptionalPlugins(ctx, claudeDir)
  await syncLspServers(ctx)
  return runtime
}

// ----------------------------------------------------------- runtime ----

function syncClaudeRuntime(ctx: Ctx, runtime: ClaudeRuntimeState): void {
  const { change, echo, verbose, warn } = ctx.services.logger
  if (runtime.kind === "deferred") {
    warn("Bun unavailable — Claude statusline/hooks migration deferred; install Bun, then re-run sync claude")
    return
  }
  if (ctx.dryRun) {
    echo("[dry-run] install statusline.mjs, session-start.mjs, notify.mjs, notification.mp3")
    return
  }

  mkdirSync(p(ctx.home, ".claude", "bin"), { recursive: true })
  let changed = false
  for (const [path, source] of [
    [runtime.paths.statusline, "SoT/.claude/bin/statusline.mjs"],
    [runtime.paths.sessionStart, "SoT/.claude/bin/session-start.mjs"],
    [runtime.paths.notify, "SoT/.claude/bin/notify.mjs"]
  ] as const) {
    if (writeTextIfChanged(path, payloadText(source))) changed = true
  }
  if (writeBytesIfChanged(p(ctx.home, ".claude", "notification.mp3"), payloadBytes("notification.mp3"))) changed = true
  if (changed) {
    change("Claude runtime synced (statusline, session-start, notify, notification)")
    ctx.nextStepTriggers.claudeRestart = true
  } else {
    verbose("Claude runtime already in sync (statusline, session-start, notify, notification)")
  }
}

function syncClaudeMd(ctx: Ctx, claudeDir: string): void {
  const { change, echo, verbose } = ctx.services.logger
  if (ctx.dryRun) {
    echo("[dry-run] cp SoT/.claude/CLAUDE.md -> ~/.claude/CLAUDE.md")
    return
  }

  const source = payloadText("SoT/.claude/CLAUDE.md")
  if (writeTextIfChanged(p(claudeDir, "CLAUDE.md"), source)) {
    change("CLAUDE.md synced")
  } else {
    verbose("CLAUDE.md already in sync")
  }
}

// ------------------------------------------------------------- settings ----

export interface PreparedClaudeSettings {
  readonly path: string
  readonly bytes: string
  readonly previousBytes: string | undefined
  readonly changed: boolean
}

function assertMaterializedSettings(bytes: string): void {
  if (bytes.includes("__DOCKS_KIT_")) throw new Error("Claude settings contain unresolved runtime sentinels")
}

/** Build the candidate settings bytes before the readiness-gated runtime cutover mutates disk. */
export function prepareClaudeSettings(ctx: Ctx, claudeDir: string, repo: Json): PreparedClaudeSettings {
  const path = p(claudeDir, "settings.json")
  if (!existsSync(path)) {
    const bytes = jqStringify(repo)
    assertMaterializedSettings(bytes)
    return { path, bytes, previousBytes: undefined, changed: true }
  }

  const previousBytes = readFileSync(path, "utf8")
  const user = parseJson(previousBytes)
  if (user === undefined || !isObject(user)) {
    const reason = user === undefined ? "is not valid JSON" : "must contain a JSON object"
    ctx.services.logger.err(`Aborting sync: ${path} ${reason}. Fix it manually or delete it to reinstall.`)
    throw new ExitError(1)
  }
  const merged = ctx.reconcile ? reconcileSettings(repo, user) : mergeSettings(repo, user)
  const bytes = jqStringify(merged)
  assertMaterializedSettings(bytes)
  return { path, bytes, previousBytes, changed: bytes !== previousBytes }
}

/** Commit a fully prepared document; callers must finish runtime preparation first. */
export function commitClaudeSettings(ctx: Ctx, prepared: PreparedClaudeSettings): void {
  const { change, verbose } = ctx.services.logger
  if (!prepared.changed) {
    verbose("Settings already in sync")
    return
  }

  if (prepared.previousBytes !== undefined) copyFileSync(prepared.path, `${prepared.path}.bak`)
  writeFileSync(`${prepared.path}.tmp`, prepared.bytes)
  renameSync(`${prepared.path}.tmp`, prepared.path)
  ctx.nextStepTriggers.claudeRestart = true
  if (prepared.previousBytes === undefined) {
    change("Settings installed")
  } else if (ctx.reconcile) {
    change("Settings reconciled (backup at settings.json.bak; user-only keys preserved, permissions arrays replaced by SoT)")
  } else {
    change("Settings merged (backup at settings.json.bak)")
  }
}

function describeSettingsSync(ctx: Ctx, claudeDir: string): void {
  const { echo } = ctx.services.logger
  const repoSettings = payloadDisplayPath("SoT/.claude/settings.json")
  const userSettings = p(claudeDir, "settings.json")

  if (!existsSync(userSettings)) {
    echo(`[dry-run] install ${repoSettings} -> ${userSettings}`)
  } else if (ctx.reconcile) {
    echo(`[dry-run] reconcile ${repoSettings} -> ${userSettings} (SoT keys win; permissions arrays replaced; user-only keys preserved)`)
  } else {
    echo(`[dry-run] merge ${repoSettings} -> ${userSettings} (SoT keys win; permissions arrays unioned; user-only keys preserved)`)
  }
}

/** Shared shape of the three jq-edit modifiers (compact window, permissive). */
function jqEditSettings(ctx: Ctx, claudeDir: string, tag: string, edit: (doc: Json) => void): boolean {
  const { err, warn } = ctx.services.logger
  const userSettings = p(claudeDir, "settings.json")
  if (!existsSync(userSettings)) {
    warn(`(${tag}) ${userSettings} missing — skipped`)
    return false
  }
  const before = readFileSync(userSettings, "utf8")
  const doc = parseJson(before)
  if (doc === undefined) {
    err(`(${tag}) ${userSettings} is not valid JSON — skipped`)
    return false
  }
  edit(doc)
  const out = jqStringify(doc)
  if (out === before) return false
  writeFileSync(`${userSettings}.tmp`, out)
  renameSync(`${userSettings}.tmp`, userSettings)
  return true
}

function syncCompactWindow(ctx: Ctx, claudeDir: string): void {
  const { change, echo, verbose } = ctx.services.logger
  if (ctx.claudeCompactWindow === "") return

  if (ctx.dryRun) {
    echo(`[dry-run] (--claude-compact-window) set env.CLAUDE_CODE_AUTO_COMPACT_WINDOW=${ctx.claudeCompactWindow} in ${p(claudeDir, "settings.json")}`)
    return
  }

  const changed = jqEditSettings(ctx, claudeDir, "--claude-compact-window", (doc) => {
    if (!isObject(doc)) return
    const env = isObject(doc["env"]) ? doc["env"] : {}
    env["CLAUDE_CODE_AUTO_COMPACT_WINDOW"] = ctx.claudeCompactWindow
    doc["env"] = env
  })
  if (changed) {
    change(`Compact window: set to ${ctx.claudeCompactWindow} tokens in deployed settings (SoT and model unchanged; flag-less sync reverts)`)
    ctx.nextStepTriggers.claudeRestart = true
  }
  else verbose(`Compact window: already set to ${ctx.claudeCompactWindow} tokens in deployed settings`)
}

function syncPermissive(ctx: Ctx, claudeDir: string): void {
  const { change, echo, verbose } = ctx.services.logger
  if (!ctx.claudePermissive) return

  if (ctx.dryRun) {
    echo(`[dry-run] (--claude-permissive) empty permissions.ask and permissions.deny in ${p(claudeDir, "settings.json")}`)
    return
  }

  const changed = jqEditSettings(ctx, claudeDir, "--claude-permissive", (doc) => {
    if (!isObject(doc)) return
    const permissions = isObject(doc["permissions"]) ? doc["permissions"] : {}
    permissions["ask"] = []
    permissions["deny"] = []
    doc["permissions"] = permissions
  })
  if (changed) {
    change("Permissive mode: permissions.ask/deny emptied in deployed settings (sandbox use; SoT unchanged)")
    ctx.nextStepTriggers.claudeRestart = true
  }
  else verbose("Permissive mode: permissions.ask/deny already empty in deployed settings")
}

// ---------------------------------------------------------- claude.json ----

function syncClaudeJson(ctx: Ctx): void {
  const { change, echo, err, verbose } = ctx.services.logger
  const claudeJson = p(ctx.home, ".claude.json")

  const mcp: Json | undefined = parseJson(payloadText("SoT/.claude/mcp-servers.json"))
  const haveMcp = mcp !== undefined

  if (ctx.dryRun) {
    echo("[dry-run] set showTurnDuration=true in ~/.claude.json")
    if (haveMcp) echo("[dry-run] merge mcpServers from SoT/.claude/mcp-servers.json into ~/.claude.json")
    return
  }

  const applyFilter = (doc: { [k: string]: Json }): void => {
    doc["showTurnDuration"] = true
    if (haveMcp) {
      const sotServers = isObject(mcp!) ? mcp!["mcpServers"] ?? {} : {}
      doc["mcpServers"] = deepMerge(isObject(doc["mcpServers"]) ? doc["mcpServers"] : {}, sotServers)
    }
  }

  let changed = true
  if (existsSync(claudeJson)) {
    const before = readFileSync(claudeJson, "utf8")
    const doc = parseJson(before)
    if (doc === undefined || !isObject(doc)) {
      const reason = doc === undefined ? "not valid JSON" : "root must be a JSON object"
      err(`Skipping ~/.claude.json edit: ${reason}. Fix or delete it.`)
      return
    }
    const obj = doc
    applyFilter(obj)
    const out = jqStringify(obj)
    if (out === before) {
      changed = false
    } else {
      writeFileSync(`${claudeJson}.tmp`, out)
      renameSync(`${claudeJson}.tmp`, claudeJson)
    }
  } else {
    const obj: { [k: string]: Json } = {}
    applyFilter(obj)
    writeFileSync(claudeJson, jqStringify(obj))
  }
  if (changed) {
    change(`~/.claude.json updated (showTurnDuration${haveMcp ? ", mcpServers" : ""})`)
    ctx.nextStepTriggers.claudeRestart = true
  }
  else verbose(`~/.claude.json already in sync (showTurnDuration${haveMcp ? ", mcpServers" : ""})`)
}

// -------------------------------------------------------- connector env ----

async function syncConnectorEnv(ctx: Ctx): Promise<void> {
  const { change, echo, verbose, warn } = ctx.services.logger
  const name = "ENABLE_CLAUDEAI_MCP_SERVERS"
  const setting = hostOs().environmentSetting(name, "false")

  switch (setting.kind) {
    case "profile": {
      const marker = "# docks-kit: disable claude.ai cloud MCP connectors (set =true to keep them)"
      const candidates = setting.candidates.map((candidate) => p(ctx.home, candidate))

      for (const f of candidates) {
        if (existsSync(f) && readFileSync(f, "utf8").includes(name)) {
          if (ctx.dryRun) {
            echo(`[dry-run] ${name} already in ${f} — would skip`)
          } else {
            verbose(`claude.ai connectors: ${name} already set in ${f} (left as-is)`)
          }
          return
        }
      }

      const target = p(ctx.home, setting.target(process.env["SHELL"]))
      if (ctx.dryRun) {
        echo(`[dry-run] append '${setting.line}' to ${target}`)
        return
      }

      appendFileSync(target, `\n${marker}\n${setting.line}\n`)
      change(`claude.ai connectors disabled via ${target} (start a new shell to apply)`)
      ctx.nextStepTriggers.claudeRestart = true
      return
    }
    case "command": {
      const existing = await spawnProcess(setting.probe.command, setting.probe.args, { stdio: "ignore" })
      if (existing.error === undefined && existing.exitCode === 0) {
        if (ctx.dryRun) echo(`[dry-run] ${name} already in ${setting.location} — would skip`)
        else verbose(`claude.ai connectors: ${name} already set in ${setting.location} (left as-is)`)
        return
      }

      const applyCommand = [setting.apply.command, ...setting.apply.args].join(" ")
      if (ctx.dryRun) {
        echo(`[dry-run] ${applyCommand} (${setting.location})`)
        return
      }

      const applied = await spawnProcess(setting.apply.command, setting.apply.args, { stdio: "ignore" })
      if (applied.error === undefined && applied.exitCode === 0) {
        change(`claude.ai connectors disabled via ${setting.apply.command} (open a new terminal to apply)`)
        ctx.nextStepTriggers.claudeRestart = true
      } else {
        warn(`${applyCommand} failed — ${setting.manualHint}`)
      }
      return
    }
  }
}

// ------------------------------------------------------------- removals ----

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

function syncRemovals(ctx: Ctx, claudeDir: string, runtime: ClaudeRuntimeState): void {
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

// -------------------------------------------------------------- summary ----

export function claudeSummary(ctx: Ctx, runtime: ClaudeRuntimeState): void {
  const { echo } = ctx.services.logger
  const claudeDir = p(ctx.home, ".claude")
  echo(`Claude:   ${claudeDir}`)
  if (!ctx.dryRun) {
    if (runtime.kind === "ready") {
      echo("Hooks:    Bun (statusline, session-start, notify)")
    } else {
      echo("Hooks:    migration deferred (Bun unavailable; existing hook/statusline settings preserved)")
    }
    if (ctx.services.deps.probe("claude").state === "present") {
      const installed = readJsonFile(p(claudeDir, "plugins", "installed_plugins.json"))
      const count = installed !== undefined && isObject(installed) && isObject(installed["plugins"]) ? Object.keys(installed["plugins"]).length : 0
      echo(`Plugins:  ${count} installed (from SoT enabledPlugins + Anthropic auto-installs)`)
    } else {
      echo("Plugins:  skipped - claude CLI not installed")
    }
  }
}

export function claudeNextSteps(ctx: Ctx): Array<string> {
  const lines: Array<string> = []
  if (ctx.verbose || ctx.nextStepTriggers.claudePlugins) {
    lines.push("In a Claude Code session, run /reload-plugins to pick up newly installed plugins.")
  }
  if (ctx.verbose || ctx.nextStepTriggers.claudeRestart) {
    lines.push("Restart Claude Code for hook/env-var changes to take effect.")
  }
  return lines
}
