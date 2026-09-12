/**
 * EngineNative `sync claude` plugin install and refresh passes. Pass order
 * inside `syncPlugins` is load-bearing and golden-tested; message strings
 * and spawned argv are part of the contract.
 */
import { existsSync, renameSync, writeFileSync } from "node:fs"
import { p, spawnProcess } from "./exec"
import { recordFailure } from "./failures"
import type { Ctx } from "./index"
import { compareCodepoints, deepMerge, isObject, jqStringify, parseJson, readJsonFile, type Json } from "./jq"
import { payloadText } from "../payload"
import type { JsonObject } from "./sharedTypes"

export async function cli(args: Array<string>): Promise<{ ok: boolean; out: string; detail: string }> {
  const res = await spawnProcess("claude", args, { stdio: ["ignore", "pipe", "pipe"] })
  // A spawn error carries its cause in `error`, not in either stream, and that
  // is the case a failure message cannot afford to drop: it names an
  // unresolvable launcher instead of a rejected command.
  const out = res.error !== undefined ? res.error.message : `${res.stdout}${res.stderr}`
  const detail = out.split("\n").map((line) => line.trim()).find((line) => line !== "") ?? "unknown error"
  return { ok: res.error === undefined && res.exitCode === 0, out, detail }
}

/** Failure message tail: the cause, then the command to re-run by hand. */
function manually(detail: string, args: Array<string>): string {
  return `${detail}; run manually: claude ${args.join(" ")}`
}

function sortedKeys(obj: Json | undefined): Array<string> {
  return obj !== undefined && isObject(obj) ? Object.keys(obj).sort(compareCodepoints) : []
}

/** claude::_plugin_user_scope_installed. */
export function pluginUserScopeInstalled(installedPlugins: string, pluginId: string): boolean {
  const doc = readJsonFile(installedPlugins)
  if (doc === undefined || !isObject(doc) || !isObject(doc["plugins"])) return false
  const rec = (doc["plugins"] as JsonObject)[pluginId]
  if (rec === undefined || rec === null) return false
  const records = Array.isArray(rec) ? rec : [rec]
  return records.some((r) => isObject(r) && r["scope"] === "user")
}

function nonUserScopeMarketplaces(installedDoc: Json | undefined): Set<string> {
  const marketplaces = new Set<string>()
  if (installedDoc === undefined || !isObject(installedDoc) || !isObject(installedDoc["plugins"])) {
    return marketplaces
  }

  for (const [pluginId, value] of Object.entries(installedDoc["plugins"])) {
    const records = Array.isArray(value) ? value : [value]
    const hasNonUserInstall = records.some(
      (record) => isObject(record) && (record["scope"] === "project" || record["scope"] === "local")
    )
    if (!hasNonUserInstall) continue
    const separator = pluginId.lastIndexOf("@")
    if (separator > 0) marketplaces.add(pluginId.slice(separator + 1))
  }
  return marketplaces
}

export async function syncPlugins(ctx: Ctx, claudeDir: string): Promise<void> {
  const { change, clearProgress, echo, progress, verbose, warn } = ctx.services.logger
  const knownMarketplaces = p(claudeDir, "plugins", "known_marketplaces.json")
  const installedPlugins = p(claudeDir, "plugins", "installed_plugins.json")

  if (ctx.dryRun) {
    echo(
      ctx.skipPluginRefresh
        ? "[dry-run] bootstrap + install missing plugins from SoT; skip refresh-only plugin updates"
        : "[dry-run] bootstrap + update plugin marketplaces + plugins from SoT"
    )
    if (ctx.prune) {
      echo("[dry-run] (--prune) would also uninstall plugins not in SoT and remove extra marketplaces")
    }
    return
  }

  if (ctx.services.deps.probe("claude").state === "missing") {
    warn("claude CLI not in PATH — skipping plugin reconcile (run /plugin marketplace add + /plugin install manually)")
    return
  }
  if (ctx.services.deps.probe("git").state === "missing") {
    ctx.services.deps.warnMissing(
      "git",
      ctx.services.logger,
      "plugin marketplaces are git repos — Claude plugin passes skipped; re-run sync after installing"
    )
    return
  }

  const repoSettings = parseJson(payloadText("SoT/.claude/settings.json"))
  const repoObj = repoSettings !== undefined && isObject(repoSettings) ? repoSettings : {}
  const sotMarketplaces = isObject(repoObj["extraKnownMarketplaces"]) ? repoObj["extraKnownMarketplaces"] : {}
  const sotPlugins = isObject(repoObj["enabledPlugins"]) ? repoObj["enabledPlugins"] : {}

  // Pass 1 — add missing marketplaces (SoT insertion order, like to_entries).
  let addedMp = 0
  let f1 = 0
  for (const [mpName, mpValue] of Object.entries(sotMarketplaces)) {
    const known = readJsonFile(knownMarketplaces)
    if (known !== undefined && isObject(known) && known[mpName] !== undefined && known[mpName] !== null && known[mpName] !== false) continue
    const repo = isObject(mpValue) && isObject(mpValue["source"]) ? String((mpValue["source"] as JsonObject)["repo"] ?? "") : ""
    progress(`Adding marketplace ${mpName}...`)
    const marketplaceResult = await cli(["plugin", "marketplace", "add", repo])
    clearProgress()
    if (marketplaceResult.ok) {
      addedMp++
    } else {
      recordFailure(
        ctx,
        `Failed to add marketplace: ${mpName} (${repo}): ${manually(marketplaceResult.detail, ["plugin", "marketplace", "add", repo])}`
      )
      f1++
    }
  }

  // Pass 2 — install SoT-enabled plugins missing at user scope (jq keys[] sorts),
  // refreshing each source marketplace once so the install resolves a current snapshot.
  let addedPl = 0
  let f2 = 0
  let f3 = 0
  let f4 = 0
  const refreshedMarketplaces = new Set<string>()
  for (const pluginId of sortedKeys(sotPlugins)) {
    if (pluginUserScopeInstalled(installedPlugins, pluginId)) continue
    const separator = pluginId.lastIndexOf("@")
    const mpName = separator > 0 ? pluginId.slice(separator + 1) : ""
    if (mpName !== "" && !refreshedMarketplaces.has(mpName)) {
      progress(`Refreshing marketplace ${mpName}...`)
      const refreshResult = await cli(["plugin", "marketplace", "update", mpName])
      clearProgress()
      if (!refreshResult.ok) {
        recordFailure(
          ctx,
          `Failed to refresh marketplace: ${mpName}: ${manually(refreshResult.detail, ["plugin", "marketplace", "update", mpName])}`
        )
        f3++
      }
      refreshedMarketplaces.add(mpName)
    }
    progress(`Installing plugin ${pluginId}...`)
    const installResult = await cli(["plugin", "install", pluginId])
    clearProgress()
    if (installResult.ok) {
      addedPl++
    } else {
      recordFailure(
        ctx,
        `Failed to install plugin: ${pluginId}: ${manually(installResult.detail, ["plugin", "install", pluginId])}`
      )
      f2++
    }
  }

  let updatedPl = 0
  const installedDoc = readJsonFile(installedPlugins)
  const installedKeys = installedDoc !== undefined && isObject(installedDoc) ? sortedKeys(installedDoc["plugins"]) : []
  const nonUserMarketplaces = nonUserScopeMarketplaces(installedDoc)
  // Kit-owned plugin IDs: SoT-declared plus this run's --claude-plugin opt-ins.
  const kitPluginIds = new Set<string>(Object.keys(sotPlugins))
  if (ctx.claudePlugins.includes("supabase")) kitPluginIds.add("supabase@claude-plugins-official")
  if (ctx.claudePlugins.includes("n8n")) kitPluginIds.add("n8n-mcp-skills@n8n-mcp-skills")

  // Kit-owned marketplaces: SoT-declared plus every marketplace those plugins come from.
  const kitMarketplaces = new Set<string>(Object.keys(sotMarketplaces))
  for (const pluginId of kitPluginIds) {
    const separator = pluginId.lastIndexOf("@")
    if (separator > 0) kitMarketplaces.add(pluginId.slice(separator + 1))
  }

  // Pass 3 — refresh the kit-owned marketplaces unless the caller passed
  // --skip-plugin-refresh by hand. Pass 2 already refreshed the source
  // marketplace of every plugin it installed, so skip those: a second
  // fetch seconds later cannot resolve a newer snapshot, and re-running it
  // would duplicate one failure in the ledger and in the failed-operation count.
  if (!ctx.skipPluginRefresh) {
    for (const mpName of [...kitMarketplaces].sort(compareCodepoints)) {
      if (refreshedMarketplaces.has(mpName)) continue
      progress(`Refreshing marketplace ${mpName}...`)
      const refreshResult = await cli(["plugin", "marketplace", "update", mpName])
      clearProgress()
      refreshedMarketplaces.add(mpName)
      if (!refreshResult.ok) {
        recordFailure(
          ctx,
          `Failed to refresh marketplace: ${mpName}: ${manually(refreshResult.detail, ["plugin", "marketplace", "update", mpName])}`
        )
        f3++
      }
    }
    // Pass 4 — update the kit-owned installed plugins.
    for (const pluginId of [...kitPluginIds].sort(compareCodepoints)) {
      if (!pluginUserScopeInstalled(installedPlugins, pluginId)) continue
      progress(`Updating plugin ${pluginId}...`)
      const updateResult = await cli(["plugin", "update", pluginId, "--scope", "user"])
      clearProgress()
      if (!updateResult.ok) {
        recordFailure(
          ctx,
          `Failed to update plugin: ${pluginId}: ${manually(updateResult.detail, ["plugin", "update", pluginId, "--scope", "user"])}`
        )
        f4++
      } else if (updateResult.out.includes("Successfully updated")) {
        updatedPl++
      }
    }
  }

  // Pass 5 — prune-gated user-scope plugin uninstall.
  let removedPl = 0
  let removedMp = 0
  let f5 = 0
  let f6 = 0
  if (ctx.prune) {
    for (const pluginId of installedKeys) {
      if (kitPluginIds.has(pluginId)) continue
      if (!pluginUserScopeInstalled(installedPlugins, pluginId)) continue
      progress(`Uninstalling plugin ${pluginId}...`)
      const uninstallResult = await cli(["plugin", "uninstall", "-y", "--scope", "user", pluginId])
      clearProgress()
      if (uninstallResult.ok) {
        removedPl++
      } else {
        recordFailure(
          ctx,
          `Failed to uninstall plugin: ${pluginId}: ${manually(uninstallResult.detail, ["plugin", "uninstall", "-y", "--scope", "user", pluginId])}`
        )
        f5++
      }
    }
    // Pass 6 — prune-gated marketplace removal.
    const known = readJsonFile(knownMarketplaces)
    for (const mpName of sortedKeys(known)) {
      if (mpName === "claude-plugins-official") continue
      if (nonUserMarketplaces.has(mpName)) continue
      if (kitMarketplaces.has(mpName)) continue
      progress(`Removing marketplace ${mpName}...`)
      const removeResult = await cli(["plugin", "marketplace", "remove", mpName])
      clearProgress()
      if (removeResult.ok) {
        removedMp++
      } else {
        recordFailure(
          ctx,
          `Failed to remove marketplace: ${mpName}: ${manually(removeResult.detail, ["plugin", "marketplace", "remove", mpName])}`
        )
        f6++
      }
    }
  }

  // Pass 7 — re-assert SoT enabled-state in the user settings.
  if (await reassertEnabledState(ctx, repoObj, p(claudeDir, "settings.json"))) {
    change("Plugin enable-state re-asserted from SoT in settings.json")
    ctx.nextStepTriggers.claudePlugins = true
  }

  const failed = f1 + f2 + f3 + f4 + f5 + f6
  if (addedMp > 0 || addedPl > 0 || updatedPl > 0 || removedPl > 0 || removedMp > 0) {
    change(`Plugins synced (marketplaces: +${addedMp} -${removedMp}, plugins: +${addedPl} ~${updatedPl} -${removedPl})`)
    ctx.nextStepTriggers.claudePlugins = true
  } else {
    verbose("Plugins already in sync")
  }
  if (failed > 0) {
    warn(`${failed} plugin operation(s) failed — re-run sync or install manually`)
  }
}

async function reassertEnabledState(ctx: Ctx, repoObj: JsonObject, userSettingsFile: string): Promise<boolean> {
  const { warn } = ctx.services.logger
  if (!existsSync(userSettingsFile)) return false
  const sotPlugins = isObject(repoObj["enabledPlugins"]) ? repoObj["enabledPlugins"] : {}

  let cliDisabled = false
  for (const [pluginId, value] of Object.entries(sotPlugins)) {
    if (value !== false) continue
    const user = readJsonFile(userSettingsFile)
    const enabled = user !== undefined && isObject(user) && isObject(user["enabledPlugins"]) ? (user["enabledPlugins"] as JsonObject)[pluginId] : undefined
    if (enabled !== true) continue
    const disableResult = await cli(["plugin", "disable", pluginId])
    if (disableResult.ok) {
      cliDisabled = true
    } else {
      recordFailure(
        ctx,
        `Failed to disable SoT-false plugin: ${pluginId} (will retry next sync): ${manually(disableResult.detail, ["plugin", "disable", pluginId])}`
      )
    }
  }

  const user = readJsonFile(userSettingsFile)
  if (user === undefined || !isObject(user)) {
    warn("enabledPlugins re-assert failed — false-keyed plugins may be left enabled")
    return false
  }
  const beforeCanonical = jqStringify(user)
  user["enabledPlugins"] = deepMerge(isObject(user["enabledPlugins"]) ? user["enabledPlugins"] : {}, sotPlugins)
  const out = jqStringify(user)
  if (out === beforeCanonical) return cliDisabled
  writeFileSync(`${userSettingsFile}.tmp`, out)
  renameSync(`${userSettingsFile}.tmp`, userSettingsFile)
  return true
}

