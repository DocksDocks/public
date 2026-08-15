/**
 * EngineNative `sync codex` pipeline. Line-based TOML passes intentionally
 * avoid a TOML library because reformatting user configs would be a behavior
 * change. Guard order, message strings, and backup behavior are golden-tested.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"

import { syncCodexEffort, syncCodexModel, replaceTopLevelSettingInFile } from "./codexToml"
import { p, spawnProcess } from "./exec"
import type { Ctx } from "./index"
import { compareCodepoints, isObject, jqStringify, parseJson, type Json } from "./jq"
import { hostOs } from "./os"
import { payloadBytes, payloadDisplayPath, payloadPaths, payloadText, type PayloadPath } from "../payload"

export async function codexSync(ctx: Ctx): Promise<void> {
  const codexDir = p(ctx.home, ".codex")
  const sotConfig = payloadText("SoT/.codex/config.toml")
  const userConfig = p(codexDir, "config.toml")

  await ensureBubblewrap(ctx)
  if (!ctx.dryRun) mkdirSync(codexDir, { recursive: true })
  syncConfig(ctx, sotConfig, userConfig)
  syncCodexModel(ctx, ctx.codexModel)
  syncCodexEffort(ctx, ctx.codexEffort)
  syncRules(ctx, payloadPaths("SoT/.codex/rules/"), p(codexDir, "rules"))
  syncAgentsMd(ctx, payloadText("SoT/.codex/AGENTS.md"), p(codexDir, "AGENTS.md"))
  syncMarketplace(ctx, payloadText("SoT/.codex/plugins/marketplace.json"), p(ctx.agentsDir, "plugins", "marketplace.json"))
  await removeLegacyDocksMarketplace(ctx, userConfig)
  await syncPlugins(ctx, sotConfig)
}

// ---------------------------------------------------------- bubblewrap ----

async function ensureBubblewrap(ctx: Ctx): Promise<void> {
  const { change, echo, warn } = ctx.services.logger
  if (!bwrapSupportedOs(ctx)) return

  if (ctx.dryRun) {
    echo("[dry-run] verify bubblewrap installed (recommended Codex Linux sandbox runtime)")
    return
  }

  if (ctx.services.deps.probe("bwrap").state === "present") return

  if (ctx.skipBubblewrap) {
    warn(
      "bubblewrap not installed (--skip-bubblewrap skips auto-install). Codex may use its bundled helper if user namespaces work; recommended install: sudo apt install -y bubblewrap"
    )
    return
  }

  const pmInstall = bwrapDetectPmInstallCmd(ctx)
  if (pmInstall === "") {
    warn(
      "bubblewrap not installed and no supported package manager found (apt-get/dnf/pacman/zypper). Codex may use its bundled helper if user namespaces work; install system bubblewrap manually when possible."
    )
    return
  }

  warn(`bubblewrap not installed - recommended for Codex Linux sandbox. Running: ${pmInstall} (sudo prompt may appear)`)
  const runInstaller = () =>
    spawnProcess("bash", ["-c", pmInstall], { stdio: ["inherit", "inherit", "inherit"] })
  const res = await (ctx.terminalLease?.withExclusive(runInstaller) ?? runInstaller())
  if (res.exitCode !== 0) {
    warn(`Failed to auto-install bubblewrap. Install manually: ${pmInstall}`)
    return
  }

  if (ctx.services.deps.probe("bwrap").state === "missing") {
    warn("Package install reported success but bwrap not on PATH — check installation manually")
    return
  }

  const namespaceProbe = await spawnProcess("unshare", ["-Ur", "true"], { stdio: "ignore" })
  if (namespaceProbe.error !== undefined) {
    warn(`Could not run unshare to check user namespaces: ${namespaceProbe.error.message}`)
  } else if (namespaceProbe.exitCode === 0) {
    change(`bubblewrap installed and functional (${await ctx.services.deps.version("bwrap")})`)
  } else {
    warn(
      "bubblewrap installed but unprivileged user namespaces appear blocked. On Ubuntu 24.04+, prefer loading the AppArmor bwrap-userns-restrict profile; fallback: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0"
    )
  }
}

function bwrapSupportedOs(ctx: Ctx): boolean {
  const { warn } = ctx.services.logger
  const os = hostOs(ctx.services.platform.name())
  if (os.supportsBubblewrap) return true
  if (os.id === "unknown") {
    warn("Unknown OS — skipping bubblewrap check; Codex sandbox may not work")
  }
  return false
}

function bwrapDetectPmInstallCmd(ctx: Ctx): string {
  if (ctx.services.deps.probe("apt-get").state === "present") return "sudo apt-get install -y bubblewrap"
  if (ctx.services.deps.probe("dnf").state === "present") return "sudo dnf install -y bubblewrap"
  if (ctx.services.deps.probe("pacman").state === "present") return "sudo pacman -S --noconfirm bubblewrap"
  if (ctx.services.deps.probe("zypper").state === "present") return "sudo zypper install -y bubblewrap"
  return ""
}

// --------------------------------------------------------------- config ----

function syncConfig(ctx: Ctx, sotConfigText: string, userConfig: string): void {
  const { change, echo, verbose } = ctx.services.logger
  const sotConfig = payloadDisplayPath("SoT/.codex/config.toml")

  if (ctx.dryRun) {
    if (existsSync(userConfig)) {
      echo(`[dry-run] merge ${sotConfig} -> ${userConfig}`)
    } else {
      echo(`[dry-run] install ${sotConfig} -> ${userConfig}`)
    }
    return
  }

  if (!existsSync(userConfig)) {
    writeFileSync(userConfig, sotConfigText)
    change("Codex config installed")
    ctx.nextStepTriggers.codexRestart = true
    return
  }

  // Merge into a staging copy so `.bak` is written only when the config
  // actually changes — an unconditional early backup lets a later no-op run
  // overwrite the recovery copy with already-merged content.
  const before = readFileSync(userConfig, "utf8")
  const staging = `${userConfig}.merge.tmp`
  // Normalize once before record transforms because CR bytes change table-header identity.
  writeFileSync(staging, before.replace(/\r\n/g, "\n"))

  scrubDeprecatedFeatures(ctx, staging)
  removeRetiredPluginTables(ctx, staging)
  mergeTopLevelSettings(sotConfigText, staging)
  mergeTableSettings(sotConfigText, staging)

  if (readFileSync(staging, "utf8") === before) {
    rmSync(staging, { force: true })
    verbose("Codex config already in sync")
  } else {
    copyFileSync(userConfig, `${userConfig}.bak`)
    renameSync(staging, userConfig)
    change("Codex config merged (backup at config.toml.bak; user-only keys/tables preserved)")
    ctx.nextStepTriggers.codexRestart = true
  }
}

/** codex::scrub_deprecated_features — the [features].use_legacy_landlock awk pass. */
export function scrubDeprecatedFeaturesText(content: string): string {
  const lines = content.split("\n")
  if (lines[lines.length - 1] === "") lines.pop()
  let out = ""
  let inFeatures = false
  let header = ""
  let body = ""
  let keep = false
  let changed = false
  for (const line of lines) {
    if (inFeatures) {
      if (line.startsWith("[")) {
        inFeatures = false
        if (keep) out += `${header}\n${body}`
        else changed = true
        out += `${line}\n`
        continue
      }
      if (/^use_legacy_landlock[ \t]*=/.test(line)) {
        changed = true
        continue
      }
      body += `${line}\n`
      if (/[^ \t\f\v\r]/.test(line)) keep = true
      continue
    }
    if (/^\[features\][ \t]*$/.test(line)) {
      inFeatures = true
      header = line
      body = ""
      keep = false
      continue
    }
    out += `${line}\n`
  }
  if (inFeatures) {
    if (keep) out += `${header}\n${body}`
    else changed = true
  }
  return changed ? out : content
}

function scrubDeprecatedFeatures(ctx: Ctx, userConfig: string): void {
  const { change } = ctx.services.logger
  if (!existsSync(userConfig)) return
  const content = readFileSync(userConfig, "utf8")
  const next = scrubDeprecatedFeaturesText(content)
  if (next === content) return

  writeFileSync(`${userConfig}.tmp`, next)
  renameSync(`${userConfig}.tmp`, userConfig)
  change("Codex: scrubbed deprecated [features].use_legacy_landlock")
}

const PLUGIN_TABLE_HEADER = /^\[plugins\."([^"]+)"\][ \t]*$/
/** Plugin ids the kit retired; their deployed tables are stripped on every sync. */
const RETIRED_PLUGIN_IDS: Readonly<Record<string, true>> = {
  "effect-kit@docks": true,
  "session-relay@docks": true
}

/** codex::remove_retired_plugin_tables — drop [plugins."<id>"] blocks for retired ids. */
export function removeRetiredPluginTablesText(content: string): string {
  const lines = content.split("\n")
  if (lines[lines.length - 1] === "") lines.pop()
  let out = ""
  let skipping = false
  for (const line of lines) {
    const header = PLUGIN_TABLE_HEADER.exec(line)
    if (header !== null) {
      skipping = RETIRED_PLUGIN_IDS[header[1]!] === true
      if (skipping) continue
    } else if (skipping) {
      if (!line.startsWith("[")) continue
      skipping = false
    }
    out += `${line}\n`
  }
  return out
}

function retiredPluginTables(content: string): Array<string> {
  return content
    .split("\n")
    .map((line) => PLUGIN_TABLE_HEADER.exec(line)?.[1])
    .filter((id): id is string => id !== undefined && RETIRED_PLUGIN_IDS[id] === true)
}

function removeRetiredPluginTables(ctx: Ctx, userConfig: string): void {
  const { change } = ctx.services.logger
  if (!existsSync(userConfig)) return
  const content = readFileSync(userConfig, "utf8")
  const present = retiredPluginTables(content)
  if (present.length === 0) return

  writeFileSync(`${userConfig}.tmp`, removeRetiredPluginTablesText(content))
  renameSync(`${userConfig}.tmp`, userConfig)
  for (const id of present) change(`Codex: removed retired plugin table [plugins."${id}"]`)
}

function mergeTopLevelSettings(sotConfigText: string, userConfig: string): void {
  for (const line of sotConfigText.split("\n")) {
    if (line.startsWith("[")) break
    if (/^[ \t]*($|#)/.test(line)) continue
    if (!/^[A-Za-z0-9_.-]+[ \t]*=/.test(line)) continue
    const key = line.slice(0, line.indexOf("=")).replace(/[ \t]+$/, "")
    replaceTopLevelSettingInFile(userConfig, key, line)
  }
}

interface TomlTableHeader {
  readonly path: string
}

const TOML_BASIC_ESCAPES: Readonly<Record<string, string>> = {
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
  '"': '"',
  "\\": "\\"
}

function tomlBasicEscape(line: string, offset: number): { readonly next: number; readonly value: string } | undefined {
  const escaped = line[offset]
  const simple = escaped === undefined ? undefined : TOML_BASIC_ESCAPES[escaped]
  if (simple !== undefined) return { next: offset + 1, value: simple }
  const digits = escaped === "u" ? 4 : escaped === "U" ? 8 : 0
  if (digits === 0) return undefined
  const hex = line.slice(offset + 1, offset + 1 + digits)
  if (hex.length !== digits || !/^[0-9A-Fa-f]+$/.test(hex)) return undefined
  const codePoint = Number.parseInt(hex, 16)
  if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return undefined
  return { next: offset + 1 + digits, value: String.fromCodePoint(codePoint) }
}

/** Decode a table header to the TOML path that determines managed ownership. */
function tomlTableHeader(line: string): TomlTableHeader | undefined {
  let offset = 0
  const skipWhitespace = (): void => {
    while (line[offset] === " " || line[offset] === "\t") offset++
  }

  skipWhitespace()
  if (line[offset] !== "[") return undefined
  offset++
  const array = line[offset] === "["
  if (array) offset++

  const keys: Array<string> = []
  while (true) {
    skipWhitespace()
    const quote = line[offset]
    let key = ""
    if (quote === '"' || quote === "'") {
      offset++
      let closed = false
      while (offset < line.length) {
        const char = line[offset]!
        if (char === quote) {
          offset++
          closed = true
          break
        }
        if (quote === '"' && char === "\\") {
          const escape = tomlBasicEscape(line, offset + 1)
          if (escape === undefined) return undefined
          key += escape.value
          offset = escape.next
          continue
        }
        if (char === "\n" || char === "\r") return undefined
        key += char
        offset++
      }
      if (!closed) return undefined
    } else {
      const start = offset
      while (offset < line.length && /[A-Za-z0-9_-]/.test(line[offset]!)) offset++
      if (offset === start) return undefined
      key = line.slice(start, offset)
    }
    keys.push(key)

    skipWhitespace()
    if (line[offset] === ".") {
      offset++
      continue
    }
    if (line[offset] !== "]") return undefined
    offset++
    if (array) {
      if (line[offset] !== "]") return undefined
      offset++
    }
    skipWhitespace()
    if (offset < line.length && line[offset] !== "#") return undefined
    return { path: JSON.stringify(keys) }
  }
}

function mergeTableSettingsText(sotConfigText: string, userConfigText: string): string {
  const sotLines = sotConfigText.split("\n")
  let merged = userConfigText
  for (let tableOffset = 0; tableOffset < sotLines.length; tableOffset++) {
    const managedHeader = tomlTableHeader(sotLines[tableOffset]!)
    if (managedHeader === undefined) continue

    const block: Array<string> = []
    for (let blockOffset = tableOffset; blockOffset < sotLines.length; blockOffset++) {
      const line = sotLines[blockOffset]!
      if (blockOffset !== tableOffset && tomlTableHeader(line) !== undefined) break
      block.push(line)
    }
    const tableBlock = block.join("\n").replace(/\n+$/, "")

    const userLines = merged.split("\n")
    if (userLines[userLines.length - 1] === "") userLines.pop()
    let skip = false
    const kept: Array<string> = []
    for (const line of userLines) {
      const header = tomlTableHeader(line)
      if (header !== undefined) {
        skip = header.path === managedHeader.path
        if (skip) continue
      }
      if (!skip) kept.push(line)
    }
    merged = `${kept.join("\n")}\n\n${tableBlock}\n`
  }
  return merged
}

function mergeTableSettings(sotConfigText: string, userConfig: string): void {
  const next = mergeTableSettingsText(sotConfigText, readFileSync(userConfig, "utf8"))
  writeFileSync(`${userConfig}.tmp`, next)
  renameSync(`${userConfig}.tmp`, userConfig)
}

// ------------------------------------------------------- rules + agents ----

function syncRules(ctx: Ctx, sotRules: ReadonlyArray<PayloadPath>, userRulesDir: string): void {
  const { change, echo, verbose } = ctx.services.logger
  const firstRule = sotRules[0]
  if (firstRule === undefined) return
  const firstDisplay = payloadDisplayPath(firstRule)
  const sotRulesDir = firstDisplay.slice(0, firstDisplay.lastIndexOf("/"))

  if (ctx.dryRun) {
    echo(`[dry-run] cp ${sotRulesDir}/*.rules -> ${userRulesDir}/`)
    return
  }

  mkdirSync(userRulesDir, { recursive: true })
  let sawRules = false
  let rulesChanged = false
  const ruleFiles = sotRules.filter((path) => path.endsWith(".rules")).sort(compareCodepoints)
  for (const ruleFile of ruleFiles) {
    sawRules = true
    const userRuleFile = p(userRulesDir, ruleFile.slice(ruleFile.lastIndexOf("/") + 1))
    const content = payloadBytes(ruleFile)
    const identical = existsSync(userRuleFile) && readFileSync(userRuleFile).equals(content)
    if (identical) continue
    if (existsSync(userRuleFile)) copyFileSync(userRuleFile, `${userRuleFile}.bak`)
    writeFileSync(userRuleFile, content)
    rulesChanged = true
  }
  if (rulesChanged) {
    change("Codex rules synced")
    ctx.nextStepTriggers.codexRestart = true
  } else if (sawRules) verbose("Codex rules already in sync")
}

function syncAgentsMd(ctx: Ctx, sotAgentsMdText: string, userAgentsMd: string): void {
  const { change, echo, verbose } = ctx.services.logger
  const sotAgentsMd = payloadDisplayPath("SoT/.codex/AGENTS.md")

  if (ctx.dryRun) {
    echo(`[dry-run] cp ${sotAgentsMd} -> ${userAgentsMd}`)
    return
  }

  if (existsSync(userAgentsMd) && readFileSync(userAgentsMd, "utf8") === sotAgentsMdText) {
    verbose("Codex AGENTS.md already in sync")
    return
  }
  if (existsSync(userAgentsMd)) copyFileSync(userAgentsMd, `${userAgentsMd}.bak`)
  writeFileSync(userAgentsMd, sotAgentsMdText)
  change("Codex AGENTS.md synced")
  ctx.nextStepTriggers.codexRestart = true
}

// ---------------------------------------------------------- marketplace ----

function syncMarketplace(ctx: Ctx, sotMarketplaceText: string, userMarketplace: string): void {
  const { change, echo, verbose } = ctx.services.logger
  const sotMarketplace = payloadDisplayPath("SoT/.codex/plugins/marketplace.json")
  const repo = parseJson(sotMarketplaceText)
  if (repo === undefined) throw new Error(`invalid SoT marketplace JSON: ${sotMarketplace}`)

  const userText = existsSync(userMarketplace) ? readFileSync(userMarketplace, "utf8") : undefined
  const user = userText === undefined ? undefined : parseJson(userText)
  if (userText !== undefined && user === undefined) {
    throw new Error(`invalid deployed Codex marketplace JSON: ${userMarketplace}. Fix or delete it.`)
  }
  const out = user === undefined ? undefined : jqStringify(mergeMarketplace(repo, user))

  if (ctx.dryRun) {
    if (userText === undefined) {
      echo(`[dry-run] cp ${sotMarketplace} -> ${userMarketplace}`)
    } else if (out === userText) {
      verbose("Codex marketplace already in sync")
    } else {
      echo(`[dry-run] merge ${sotMarketplace} -> ${userMarketplace} (backup at ${userMarketplace}.bak)`)
    }
    return
  }

  mkdirSync(p(ctx.agentsDir, "plugins"), { recursive: true })
  if (userText !== undefined && out !== undefined) {
    if (out === userText) {
      verbose("Codex marketplace already in sync")
      return
    }
    copyFileSync(userMarketplace, `${userMarketplace}.bak`)
    writeFileSync(`${userMarketplace}.tmp`, out)
    renameSync(`${userMarketplace}.tmp`, userMarketplace)
    change("Codex marketplace merged (backup at marketplace.json.bak)")
    ctx.nextStepTriggers.codexRestart = true
  } else {
    writeFileSync(userMarketplace, sotMarketplaceText)
    change("Codex marketplace installed")
    ctx.nextStepTriggers.codexRestart = true
  }
}

/**
 * The jq -s marketplace merge: `$user *` a {name, interface} coalesce, then
 * plugins = user+repo | reverse | unique_by(.name) | reverse — SoT (repo)
 * wins per plugin name; distinct names end up descending by name, exactly
 * like jq's unique_by (ascending) followed by reverse.
 */
export function mergeMarketplace(repo: Json, user: Json): Json {
  const u = isObject(user) ? user : {}
  const r = isObject(repo) ? repo : {}
  const coalesce = (a: Json | undefined, b: Json | undefined): Json =>
    a !== undefined && a !== null && a !== false ? a : (b ?? null)
  const merged: { [k: string]: Json } = {
    ...u,
    name: coalesce(u["name"], r["name"]),
    interface: coalesce(u["interface"], r["interface"])
  }
  const plugins = [
    ...(Array.isArray(u["plugins"]) ? u["plugins"] : []),
    ...(Array.isArray(r["plugins"]) ? r["plugins"] : [])
  ]
  const firstByName = new Map<string, Json>()
  for (const p of [...plugins].reverse()) {
    const name = isObject(p) && typeof p["name"] === "string" ? p["name"] : ""
    if (!firstByName.has(name)) firstByName.set(name, p)
  }
  merged["plugins"] = [...firstByName.keys()].sort(compareCodepoints).map((n) => firstByName.get(n)!).reverse()
  return merged
}

// -------------------------------------------------------------- plugins ----

/** codex::_marketplace_source — first `source =` inside [marketplaces.<name>]. */
export function marketplaceSource(marketplace: string, configFile: string): string {
  if (!existsSync(configFile)) return ""
  let inMarketplace = false
  for (const line of readFileSync(configFile, "utf8").split("\n")) {
    if (line === `[marketplaces.${marketplace}]`) {
      inMarketplace = true
      continue
    }
    if (line.startsWith("[")) inMarketplace = false
    if (inMarketplace && /^[ \t]*source[ \t]*=/.test(line)) {
      return line
        .replace(/^[^=]+=[ \t]*/, "")
        .replace(/[ \t]*#.*/, "")
        .replace(/^"|"$/g, "")
    }
  }
  return ""
}

async function removeLegacyDocksMarketplace(ctx: Ctx, userConfig: string): Promise<void> {
  const { change, echo, warn } = ctx.services.logger
  if (ctx.dryRun) {
    echo("[dry-run] remove legacy configured Codex Docks marketplace when personal marketplace is deployed")
    return
  }

  if (ctx.services.deps.probe("codex").state === "missing") return

  const source = marketplaceSource("docks", userConfig)
  if (source !== "https://github.com/DocksDocks/docks.git" && source !== "DocksDocks/docks") return
  const res = await spawnProcess("codex", ["plugin", "marketplace", "remove", "docks"], { stdio: "ignore" })
  if (res.error === undefined && res.exitCode === 0) {
    change("Removed legacy configured Codex Docks marketplace; using personal marketplace file")
    ctx.nextStepTriggers.codexRestart = true
  } else {
    warn("Failed to remove legacy configured Codex Docks marketplace")
  }
}

/** codex::_standalone_install_command — per-OS official standalone installer. */
const standaloneInstallCommand = (ctx: Ctx): string => ctx.services.deps.spec("codex").installHint()

/** codex::_enabled_plugin_ids — [plugins."<id>"] tables with enabled = true. */
export function enabledPluginIds(configFile: string): Array<string> {
  if (!existsSync(configFile)) return []
  return enabledPluginIdsFromText(readFileSync(configFile, "utf8"))
}

export function enabledPluginIdsFromText(configText: string): Array<string> {
  const ids: Array<string> = []
  let plugin = ""
  let enabled = false
  const flush = (): void => {
    if (plugin !== "" && enabled) ids.push(plugin)
  }
  for (const line of configText.split("\n")) {
    const m = PLUGIN_TABLE_HEADER.exec(line)
    if (m !== null) {
      flush()
      plugin = m[1]!
      enabled = false
      continue
    }
    if (line.startsWith("[")) {
      flush()
      plugin = ""
      enabled = false
      continue
    }
    if (plugin !== "" && /^[ \t]*enabled[ \t]*=[ \t]*true([ \t]*(#.*)?)?$/.test(line)) {
      enabled = true
    }
  }
  flush()
  return ids
}

function manualPluginRefreshCommand(sotConfigText: string): string {
  const first = enabledPluginIdsFromText(sotConfigText)[0]
  return first !== undefined ? `codex plugin add ${first}` : "codex plugin add <plugin@marketplace>"
}

async function installedPluginIdsFromCli(): Promise<Set<string> | undefined> {
  const result = await spawnProcess("codex", ["plugin", "list", "--json"], {
    stdio: ["ignore", "pipe", "ignore"]
  })
  if (result.error !== undefined || result.exitCode !== 0) return undefined
  const value = parseJson(result.stdout)
  if (value === undefined || !isObject(value) || !Array.isArray(value["installed"])) return undefined
  const ids = new Set<string>()
  for (const row of value["installed"]) {
    if (!isObject(row) || row["installed"] !== true || typeof row["pluginId"] !== "string") continue
    ids.add(row["pluginId"])
  }
  return ids
}

async function syncPlugins(ctx: Ctx, sotConfigText: string): Promise<void> {
  const { change, clearProgress, echo, progress, verbose, warn } = ctx.services.logger
  if (ctx.dryRun) {
    echo(
      ctx.skipPluginRefresh
        ? "[dry-run] add missing enabled Codex plugins from SoT; skip refresh-only plugin updates"
        : "[dry-run] add enabled Codex plugins from SoT"
    )
    return
  }

  if (ctx.services.deps.probe("codex").state === "missing") {
    warn(
      `codex CLI not in PATH - deployed config/marketplace only; install Codex with: ${standaloneInstallCommand(ctx)} | docs: https://developers.openai.com/codex/cli; then run: ${manualPluginRefreshCommand(sotConfigText)}`
    )
    return
  }
  if (ctx.services.deps.probe("git").state === "missing") {
    ctx.services.deps.warnMissing(
      "git",
      ctx.services.logger,
      "plugin marketplaces are git repos — Codex plugin refresh skipped; re-run sync after installing"
    )
    return
  }

  const desiredPluginIds = enabledPluginIdsFromText(sotConfigText)
  let pluginIds = desiredPluginIds
  if (ctx.skipPluginRefresh) {
    progress("Checking installed Codex plugins...")
    const installedPluginIds = await installedPluginIdsFromCli()
    clearProgress()
    if (installedPluginIds === undefined) {
      warn("Codex plugin inventory unavailable — falling back to the full refresh path")
    } else {
      pluginIds = desiredPluginIds.filter((pluginId) => !installedPluginIds.has(pluginId))
    }
  }

  let refreshed = 0
  let failed = 0
  for (const pluginId of pluginIds) {
    progress(`Updating Codex plugin ${pluginId}...`)
    const res = await spawnProcess("codex", ["plugin", "add", pluginId], { stdio: ["ignore", "pipe", "pipe"] })
    clearProgress()
    const addOut = `${res.stdout}${res.stderr}`
    if (res.error === undefined && res.exitCode === 0) {
      refreshed++
    } else if (addOut.includes("could not find a Codex CLI binary")) {
      warn(
        `Codex plugin refresh hit a stale launcher/wrapper on PATH - install current standalone Codex with: ${standaloneInstallCommand(ctx)}`
      )
      failed++
    } else {
      const failureLine = addOut.split("\n")[0] ?? ""
      warn(
        `Codex plugin refresh failed for ${pluginId}: ${failureLine !== "" ? failureLine : "unknown error"}; run manually: codex plugin add ${pluginId}`
      )
      failed++
    }
  }

  if (refreshed > 0) {
    change(`Codex plugins synced (plugins: ~${refreshed})`)
    ctx.nextStepTriggers.codexRestart = true
  }
  if (ctx.skipPluginRefresh && pluginIds.length === 0) verbose("Codex plugins already installed; refresh-only updates skipped")
  if (failed > 0) warn(`${failed} Codex plugin operation(s) failed — re-run sync or install manually`)
}

// -------------------------------------------------------------- summary ----

export function codexSummary(ctx: Ctx): void {
  const { echo } = ctx.services.logger
  const codexDir = p(ctx.home, ".codex")
  echo(`Codex:    ${codexDir}`)
  if (!ctx.dryRun) {
    const count = enabledPluginIds(p(codexDir, "config.toml")).length
    echo(`Codex plugins: ${count} enabled in config.toml`)
  }
}

export function codexNextSteps(ctx: Ctx): Array<string> {
  return ctx.verbose || ctx.nextStepTriggers.codexRestart
    ? ["Restart Codex to load any refreshed plugins, skills, or tools."]
    : []
}
