/**
 * EngineNative `sync claude` plugin, optional-plugin, and LSP passes. Pass
 * order inside `syncPlugins` is load-bearing and golden-tested; message
 * strings and spawned argv are part of the contract.
 */
import { existsSync, renameSync, writeFileSync } from "node:fs"
import { p, spawnProcess } from "./exec"
import type { Ctx } from "./index"
import { compareCodepoints, deepMerge, isObject, jqStringify, parseJson, readJsonFile, type Json } from "./jq"
import { field } from "./toolchain"
import { payloadText } from "../payload"

async function cli(args: Array<string>): Promise<{ ok: boolean; out: string }> {
  const res = await spawnProcess("claude", args, { stdio: ["ignore", "pipe", "pipe"] })
  return { ok: res.error === undefined && res.exitCode === 0, out: `${res.stdout}${res.stderr}` }
}

function sortedKeys(obj: Json | undefined): Array<string> {
  return obj !== undefined && isObject(obj) ? Object.keys(obj).sort(compareCodepoints) : []
}

/** claude::_plugin_user_scope_installed. */
export function pluginUserScopeInstalled(installedPlugins: string, pluginId: string): boolean {
  const doc = readJsonFile(installedPlugins)
  if (doc === undefined || !isObject(doc) || !isObject(doc["plugins"])) return false
  const rec = (doc["plugins"] as { [k: string]: Json })[pluginId]
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
    const repo = isObject(mpValue) && isObject(mpValue["source"]) ? String((mpValue["source"] as { [k: string]: Json })["repo"] ?? "") : ""
    progress(`Adding marketplace ${mpName}...`)
    const marketplaceResult = await cli(["plugin", "marketplace", "add", repo])
    clearProgress()
    if (marketplaceResult.ok) {
      addedMp++
    } else {
      warn(`Failed to add marketplace: ${mpName} (${repo})`)
      f1++
    }
  }

  // Pass 2 — install SoT-enabled plugins missing at user scope (jq keys[] sorts),
  // refreshing each source marketplace once so the install resolves a current snapshot.
  let addedPl = 0
  let f2 = 0
  const refreshedMarketplaces = new Set<string>()
  for (const pluginId of sortedKeys(sotPlugins)) {
    if (pluginUserScopeInstalled(installedPlugins, pluginId)) continue
    const separator = pluginId.lastIndexOf("@")
    const mpName = separator > 0 ? pluginId.slice(separator + 1) : ""
    if (mpName !== "" && !refreshedMarketplaces.has(mpName)) {
      progress(`Refreshing marketplace ${mpName}...`)
      await cli(["plugin", "marketplace", "update", mpName])
      clearProgress()
      refreshedMarketplaces.add(mpName)
    }
    progress(`Installing plugin ${pluginId}...`)
    const installResult = await cli(["plugin", "install", pluginId])
    clearProgress()
    if (installResult.ok) {
      addedPl++
    } else {
      warn(`Failed to install plugin: ${pluginId}`)
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

  // Pass 3 — refresh the kit-owned marketplaces unless the update command
  // selected its install-missing-only fast path.
  if (!ctx.skipPluginRefresh) {
    for (const mpName of [...kitMarketplaces].sort(compareCodepoints)) {
      progress(`Refreshing marketplace ${mpName}...`)
      await cli(["plugin", "marketplace", "update", mpName])
      clearProgress()
    }
    // Pass 4 — update the kit-owned installed plugins.
    for (const pluginId of [...kitPluginIds].sort(compareCodepoints)) {
      if (!pluginUserScopeInstalled(installedPlugins, pluginId)) continue
      progress(`Updating plugin ${pluginId}...`)
      const updateResult = await cli(["plugin", "update", pluginId, "--scope", "user"])
      clearProgress()
      if (updateResult.out.includes("Successfully updated")) updatedPl++
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
        warn(`Failed to uninstall plugin: ${pluginId}`)
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
        warn(`Failed to remove marketplace: ${mpName}`)
        f6++
      }
    }
  }

  // Pass 7 — re-assert SoT enabled-state in the user settings.
  if (await reassertEnabledState(ctx, repoObj, p(claudeDir, "settings.json"))) {
    change("Plugin enable-state re-asserted from SoT in settings.json")
    ctx.nextStepTriggers.claudePlugins = true
  }

  const failed = f1 + f2 + f5 + f6
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

async function reassertEnabledState(ctx: Ctx, repoObj: { [k: string]: Json }, userSettingsFile: string): Promise<boolean> {
  const { warn } = ctx.services.logger
  if (!existsSync(userSettingsFile)) return false
  const sotPlugins = isObject(repoObj["enabledPlugins"]) ? repoObj["enabledPlugins"] : {}

  let cliDisabled = false
  for (const [pluginId, value] of Object.entries(sotPlugins)) {
    if (value !== false) continue
    const user = readJsonFile(userSettingsFile)
    const enabled = user !== undefined && isObject(user) && isObject(user["enabledPlugins"]) ? (user["enabledPlugins"] as { [k: string]: Json })[pluginId] : undefined
    if (enabled !== true) continue
    if ((await cli(["plugin", "disable", pluginId])).ok) {
      cliDisabled = true
    } else {
      warn(`Failed to disable SoT-false plugin: ${pluginId} (will retry next sync)`)
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

// ------------------------------------------------------ optional plugins ----

async function enableOptionalPlugin(ctx: Ctx, claudeDir: string, pluginId: string, marketplaceRepo: string): Promise<boolean> {
  const { change, clearProgress, progress, verbose, warn } = ctx.services.logger
  const installedPlugins = p(claudeDir, "plugins", "installed_plugins.json")
  const knownMarketplaces = p(claudeDir, "plugins", "known_marketplaces.json")
  const mpName = pluginId.slice(pluginId.lastIndexOf("@") + 1)

  let marketplaceAdded = false
  if (marketplaceRepo !== "") {
    const known = readJsonFile(knownMarketplaces)
    const has = known !== undefined && isObject(known) && known[mpName] !== undefined && known[mpName] !== null && known[mpName] !== false
    if (!has) {
      if (!(await cli(["plugin", "marketplace", "add", marketplaceRepo])).ok) {
        warn(`Failed to add marketplace ${marketplaceRepo} for ${pluginId}`)
        return false
      }
      marketplaceAdded = true
    }
  }

  const wasInstalled = pluginUserScopeInstalled(installedPlugins, pluginId)
  if (!wasInstalled) {
    progress(`Installing plugin ${pluginId}...`)
    const installResult = await cli(["plugin", "install", pluginId])
    clearProgress()
    if (!installResult.ok) {
      if (marketplaceAdded) change(`Optional plugin ${pluginId}: marketplace added (install failed — will retry next sync)`)
      warn(`Failed to install optional plugin ${pluginId}`)
      return marketplaceAdded
    }
  }

  const settingsDoc = readJsonFile(p(claudeDir, "settings.json"))
  const wasEnabled =
    settingsDoc !== undefined && isObject(settingsDoc) && isObject(settingsDoc["enabledPlugins"])
      ? (settingsDoc["enabledPlugins"] as { [k: string]: Json })[pluginId] === true
      : false

  if (!(await cli(["plugin", "enable", pluginId])).ok) {
    if (marketplaceAdded || !wasInstalled) change(`Optional plugin ${pluginId}: installed (enable failed — will retry next sync)`)
    warn(`Failed to enable optional plugin ${pluginId}`)
    return marketplaceAdded || !wasInstalled
  }
  const changed = marketplaceAdded || !wasInstalled || !wasEnabled
  if (changed) change(`Optional plugin opted in: ${pluginId}`)
  else verbose(`Optional plugin already opted in: ${pluginId} (enable re-asserted)`)
  return changed
}

export async function syncOptionalPlugins(ctx: Ctx, claudeDir: string): Promise<void> {
  const { echo, warn } = ctx.services.logger
  if (ctx.claudePlugins.length === 0) return

  if (ctx.dryRun) {
    if (ctx.claudePlugins.includes("supabase")) {
      echo("[dry-run] (--claude-plugin=supabase) install + enable supabase@claude-plugins-official in deployed settings")
    }
    if (ctx.claudePlugins.includes("n8n")) {
      echo("[dry-run] (--claude-plugin=n8n) add czlonkowski/n8n-skills marketplace + install + enable n8n-mcp-skills@n8n-mcp-skills")
    }
    return
  }

  if (ctx.services.deps.probe("claude").state === "missing") {
    warn("claude CLI not in PATH — cannot opt in optional plugins (--claude-plugin)")
    return
  }

  if (ctx.claudePlugins.includes("supabase")) {
    if (await enableOptionalPlugin(ctx, claudeDir, "supabase@claude-plugins-official", "")) ctx.nextStepTriggers.claudePlugins = true
  }
  if (ctx.claudePlugins.includes("n8n")) {
    if (await enableOptionalPlugin(ctx, claudeDir, "n8n-mcp-skills@n8n-mcp-skills", "czlonkowski/n8n-skills")) ctx.nextStepTriggers.claudePlugins = true
  }
}

// ---------------------------------------------------------- LSP servers ----

function lspPkg(ctx: Ctx, tool: string, pkg: string): string | undefined {
  const version = field(tool, "verified")
  if (version !== "") return `${pkg}@${version}`
  ctx.services.logger.warn(`Skipping ${pkg} install: ${tool} has no verified version in SoT/toolchain.json`)
  return undefined
}

export async function syncLspServers(ctx: Ctx): Promise<void> {
  const { change, clearProgress, echo, progress, verbose, warn } = ctx.services.logger
  const sot = parseJson(payloadText("SoT/.claude/settings.json"))
  const enabled = sot !== undefined && isObject(sot) && isObject(sot["enabledPlugins"]) ? sot["enabledPlugins"] : undefined
  if (enabled === undefined) return
  const hasPhp = Object.prototype.hasOwnProperty.call(enabled, "php-lsp@claude-plugins-official")
  const hasTs = Object.prototype.hasOwnProperty.call(enabled, "typescript-lsp@claude-plugins-official")
  if (!hasPhp && !hasTs) return

  const phpMissing = hasPhp && ctx.services.deps.probe("intelephense").state === "missing"
  const tsServerMissing = hasTs && ctx.services.deps.probe("typescript-language-server").state === "missing"
  const tscMissing = hasTs && ctx.services.deps.probe("tsc").state === "missing"
  const missingToolCount = Number(phpMissing) + Number(tsServerMissing) + Number(tscMissing)
  const missing = [
    phpMissing ? lspPkg(ctx, "intelephense", "intelephense") : undefined,
    tsServerMissing ? lspPkg(ctx, "typescript-language-server", "typescript-language-server") : undefined,
    tscMissing ? lspPkg(ctx, "tsc", "typescript") : undefined
  ].filter((spec): spec is string => spec !== undefined)

  if (missingToolCount === 0) {
    if (ctx.dryRun) {
      echo("[dry-run] LSP server binaries present")
    } else {
      verbose("LSP server binaries present")
    }
    return
  }
  if (missing.length === 0) return

  const specs = missing.join(" ")
  if (ctx.dryRun) {
    echo(`[dry-run] would install: npm install -g ${specs}`)
    return
  }

  if (ctx.services.deps.probe("npm").state === "missing") {
    ctx.services.deps.warnMissing(
      "npm",
      ctx.services.logger,
      `cannot install LSP servers (${specs}); the php-lsp/typescript-lsp plugins stay no-ops`
    )
    return
  }

  verbose(`Installing LSP servers via npm: ${specs}...`)
  progress(`Installing LSP servers via npm: ${specs}...`)
  const installResult = await spawnProcess("npm", ["install", "-g", ...missing], { stdio: "ignore" })
  clearProgress()
  if (installResult.exitCode === 0) {
    change(`LSP servers installed (${specs})`)
    ctx.nextStepTriggers.claudeRestart = true
  } else {
    warn(`npm install -g ${specs} failed. Try manually: npm install -g ${specs}`)
  }
}
