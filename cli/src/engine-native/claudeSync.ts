/**
 * EngineNative `sync claude` pipeline. Step order is load-bearing: the Bun
 * bootstrap BEFORE the settings merge, modifiers after it, removals before
 * plugins. Message strings, guard order, JSON semantics, and spawned argv are
 * golden-tested.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { bunBootstrap } from "./bun"
import {
  syncClaudeAdvisor,
  syncClaudeEffort,
  syncClaudeModel
} from "./claudeSettingsModifiers"
import { claudeRuntimePaths, materializeClaudeSettings, type ClaudeRuntimePaths } from "./claudeRuntime"
import {
  commitClaudeSettings,
  describeSettingsSync,
  prepareClaudeSettings,
  syncCompactWindow,
  syncPermissive
} from "./claudeSettings"
import { syncRemovals } from "./claudeRemovals"
import { syncOptionalPlugins, syncPlugins } from "./claudePluginPasses"
import { syncLspServers } from "./claudeLsp"
import { p, spawnProcess, writeBytesIfChanged, writeTextIfChanged } from "./exec"
import type { Ctx } from "./index"
import { deepMerge, isObject, jqStringify, parseJson, readJsonFile, type Json } from "./jq"
import { ExitError } from "./parseArgs"
import { hostOs } from "./os"
import { payloadBytes, payloadText } from "../payload"
import type { JsonObject } from "./sharedTypes"
export type { PreparedClaudeSettings } from "./claudeSettings"
export { commitClaudeSettings, prepareClaudeSettings } from "./claudeSettings"

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

  const applyFilter = (doc: JsonObject): void => {
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
    const obj: JsonObject = {}
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
