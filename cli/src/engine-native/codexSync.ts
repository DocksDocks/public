/**
 * EngineNative `sync codex` pipeline. Line-based TOML passes intentionally
 * avoid a TOML library because reformatting user configs would be a behavior
 * change. Guard order, message strings, and backup behavior are golden-tested.
 */
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"

import { syncCodexModel, replaceTopLevelSettingInFile } from "./codexToml"
import { p } from "./exec"
import type { Ctx } from "./index"
import { compareCodepoints, isObject, jqStringify, parseJson, type Json } from "./jq"

export function codexSync(ctx: Ctx): void {
  const codexDir = p(ctx.home, ".codex")
  const sotConfig = p(ctx.repoDir, "SoT", ".codex", "config.toml")
  const userConfig = p(codexDir, "config.toml")

  ensureBubblewrap(ctx)
  if (!ctx.dryRun) mkdirSync(codexDir, { recursive: true })
  syncConfig(ctx, sotConfig, userConfig)
  syncCodexModel(ctx, ctx.codexModel)
  syncRules(ctx, p(ctx.repoDir, "SoT", ".codex", "rules"), p(codexDir, "rules"))
  syncAgentsMd(ctx, p(ctx.repoDir, "SoT", ".codex", "AGENTS.md"), p(codexDir, "AGENTS.md"))
  syncMarketplace(ctx, p(ctx.repoDir, "SoT", ".codex", "plugins", "marketplace.json"), p(ctx.agentsDir, "plugins", "marketplace.json"))
  removeLegacyDocksMarketplace(ctx, userConfig)
  syncPlugins(ctx, sotConfig)
}

// ---------------------------------------------------------- bubblewrap ----

function ensureBubblewrap(ctx: Ctx): void {
  const { change, echo, warn } = ctx.services.logger
  if (!bwrapSupportedOs(ctx)) return

  if (ctx.dryRun) {
    echo("[dry-run] verify bubblewrap installed (recommended Codex Linux sandbox runtime)")
    return
  }

  if (ctx.services.deps.probe("bwrap").state === "present") return

  if (ctx.skipRtk) {
    warn(
      "bubblewrap not installed (--skip-rtk skips auto-install). Codex may use its bundled helper if user namespaces work; recommended install: sudo apt install -y bubblewrap"
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
  const res = spawnSync("bash", ["-c", pmInstall], { stdio: ["inherit", "inherit", "inherit"] })
  if (res.status !== 0) {
    warn(`Failed to auto-install bubblewrap. Install manually: ${pmInstall}`)
    return
  }

  if (ctx.services.deps.probe("bwrap").state === "missing") {
    warn("Package install reported success but bwrap not on PATH — check installation manually")
    return
  }

  if (spawnSync("unshare", ["-Ur", "true"], { stdio: "ignore" }).status === 0) {
    change(`bubblewrap installed and functional (${ctx.services.deps.version("bwrap")})`)
  } else {
    warn(
      "bubblewrap installed but unprivileged user namespaces appear blocked. On Ubuntu 24.04+, prefer loading the AppArmor bwrap-userns-restrict profile; fallback: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0"
    )
  }
}

function bwrapSupportedOs(ctx: Ctx): boolean {
  const { warn } = ctx.services.logger
  const pn = ctx.services.platform.name()
  if (pn === "linux") return true
  if (pn === "darwin" || pn === "windows") return false
  warn("Unknown OS — skipping bubblewrap check; Codex sandbox may not work")
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

function syncConfig(ctx: Ctx, sotConfig: string, userConfig: string): void {
  const { change, echo, verbose } = ctx.services.logger
  if (!existsSync(sotConfig)) return

  if (ctx.dryRun) {
    echo(`[dry-run] merge ${sotConfig} -> ${userConfig}`)
    return
  }

  if (!existsSync(userConfig)) {
    copyFileSync(sotConfig, userConfig)
    change("Codex config installed")
    ctx.nextStepTriggers.codexRestart = true
    return
  }

  // Merge into a staging copy so `.bak` is written only when the config
  // actually changes — an unconditional early backup lets a later no-op run
  // overwrite the recovery copy with already-merged content.
  const before = readFileSync(userConfig, "utf8")
  const staging = `${userConfig}.merge.tmp`
  writeFileSync(staging, before)

  scrubDeprecatedFeatures(ctx, staging)
  mergeTopLevelSettings(sotConfig, staging)
  mergeTableSettings(sotConfig, staging)

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
  for (const line of lines) {
    if (inFeatures) {
      if (line.startsWith("[")) {
        inFeatures = false
        if (keep) out += `${header}\n${body}`
        out += `${line}\n`
        continue
      }
      if (/^use_legacy_landlock[ \t]*=/.test(line)) continue
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
  if (inFeatures && keep) out += `${header}\n${body}`
  return out
}

function scrubDeprecatedFeatures(ctx: Ctx, userConfig: string): void {
  const { change } = ctx.services.logger
  if (!existsSync(userConfig)) return
  const content = readFileSync(userConfig, "utf8")
  if (!content.split("\n").some((l) => /^use_legacy_landlock[ \t]*=/.test(l))) return

  writeFileSync(`${userConfig}.tmp`, scrubDeprecatedFeaturesText(content))
  renameSync(`${userConfig}.tmp`, userConfig)
  change("Codex: scrubbed deprecated [features].use_legacy_landlock")
}

function mergeTopLevelSettings(sotConfig: string, userConfig: string): void {
  for (const line of readFileSync(sotConfig, "utf8").split("\n")) {
    if (line.startsWith("[")) break
    if (/^[ \t]*($|#)/.test(line)) continue
    if (!/^[A-Za-z0-9_.-]+[ \t]*=/.test(line)) continue
    const key = line.slice(0, line.indexOf("=")).replace(/[ \t]+$/, "")
    replaceTopLevelSettingInFile(userConfig, key, line)
  }
}

function mergeTableSettings(sotConfig: string, userConfig: string): void {
  const sotLines = readFileSync(sotConfig, "utf8").split("\n")
  for (const tableHeader of sotLines.filter((l) => /^\[[^\]]+\]/.test(l))) {
    // Extract the SoT block: from the exact header line to (excluding) the
    // next table header; `$(...)` strips trailing newlines.
    let printing = false
    const block: Array<string> = []
    for (const line of sotLines) {
      if (line === tableHeader) printing = true
      else if (printing && line.startsWith("[")) break
      if (printing) block.push(line)
    }
    const tableBlock = block.join("\n").replace(/\n+$/, "")

    // Remove the existing block from the user config…
    const userLines = readFileSync(userConfig, "utf8").split("\n")
    if (userLines[userLines.length - 1] === "") userLines.pop()
    let skip = false
    const kept: Array<string> = []
    for (const line of userLines) {
      if (line === tableHeader) {
        skip = true
        continue
      }
      if (skip && line.startsWith("[")) skip = false
      if (!skip) kept.push(line)
    }
    // …and append the SoT block (printf '\n'; printf '%s\n' "$block").
    const next = `${kept.join("\n")}\n\n${tableBlock}\n`
    writeFileSync(`${userConfig}.tmp`, next)
    renameSync(`${userConfig}.tmp`, userConfig)
  }
}

// ------------------------------------------------------- rules + agents ----

function syncRules(ctx: Ctx, sotRulesDir: string, userRulesDir: string): void {
  const { change, echo, verbose } = ctx.services.logger
  if (!existsSync(sotRulesDir)) return

  if (ctx.dryRun) {
    echo(`[dry-run] cp ${sotRulesDir}/*.rules -> ${userRulesDir}/`)
    return
  }

  mkdirSync(userRulesDir, { recursive: true })
  let sawRules = false
  let rulesChanged = false
  const ruleFiles = readdirSync(sotRulesDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".rules"))
    .map((e) => p(sotRulesDir, e.name))
    .sort(compareCodepoints)
  for (const ruleFile of ruleFiles) {
    sawRules = true
    const userRuleFile = p(userRulesDir, ruleFile.slice(ruleFile.lastIndexOf("/") + 1))
    const identical = existsSync(userRuleFile) && readFileSync(userRuleFile).equals(readFileSync(ruleFile))
    if (identical) continue
    if (existsSync(userRuleFile)) copyFileSync(userRuleFile, `${userRuleFile}.bak`)
    copyFileSync(ruleFile, userRuleFile)
    rulesChanged = true
  }
  if (rulesChanged) {
    change("Codex rules synced")
    ctx.nextStepTriggers.codexRestart = true
  } else if (sawRules) verbose("Codex rules already in sync")
}

function syncAgentsMd(ctx: Ctx, sotAgentsMd: string, userAgentsMd: string): void {
  const { change, echo, verbose } = ctx.services.logger
  if (!existsSync(sotAgentsMd)) return

  if (ctx.dryRun) {
    echo(`[dry-run] cp ${sotAgentsMd} -> ${userAgentsMd}`)
    return
  }

  if (existsSync(userAgentsMd) && readFileSync(userAgentsMd).equals(readFileSync(sotAgentsMd))) {
    verbose("Codex AGENTS.md already in sync")
    return
  }
  if (existsSync(userAgentsMd)) copyFileSync(userAgentsMd, `${userAgentsMd}.bak`)
  copyFileSync(sotAgentsMd, userAgentsMd)
  change("Codex AGENTS.md synced")
  ctx.nextStepTriggers.codexRestart = true
}

// ---------------------------------------------------------- marketplace ----

function syncMarketplace(ctx: Ctx, sotMarketplace: string, userMarketplace: string): void {
  const { change, echo, err, verbose } = ctx.services.logger
  if (!existsSync(sotMarketplace)) return

  if (ctx.dryRun) {
    echo(`[dry-run] cp ${sotMarketplace} -> ${userMarketplace}`)
    return
  }

  mkdirSync(p(ctx.agentsDir, "plugins"), { recursive: true })
  const repo = parseJson(readFileSync(sotMarketplace, "utf8"))
  if (repo === undefined) throw new Error(`invalid SoT marketplace JSON: ${sotMarketplace}`)

  if (existsSync(userMarketplace)) {
    const user = parseJson(readFileSync(userMarketplace, "utf8"))
    if (user === undefined) {
      err(`Skipping marketplace sync: ${userMarketplace} is not valid JSON. Fix or delete it.`)
      return
    }
    const out = jqStringify(mergeMarketplace(repo, user))
    if (out === readFileSync(userMarketplace, "utf8")) {
      verbose("Codex marketplace already in sync")
      return
    }
    copyFileSync(userMarketplace, `${userMarketplace}.bak`)
    writeFileSync(`${userMarketplace}.tmp`, out)
    renameSync(`${userMarketplace}.tmp`, userMarketplace)
    change("Codex marketplace merged (backup at marketplace.json.bak)")
    ctx.nextStepTriggers.codexRestart = true
  } else {
    copyFileSync(sotMarketplace, userMarketplace)
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

function removeLegacyDocksMarketplace(ctx: Ctx, userConfig: string): void {
  const { change, echo, warn } = ctx.services.logger
  if (ctx.dryRun) {
    echo("[dry-run] remove legacy configured Codex Docks marketplace when personal marketplace is deployed")
    return
  }

  if (ctx.services.deps.probe("codex").state === "missing") return

  const source = marketplaceSource("docks", userConfig)
  if (source !== "https://github.com/DocksDocks/docks.git" && source !== "DocksDocks/docks") return
  const res = spawnSync("codex", ["plugin", "marketplace", "remove", "docks"], { stdio: "ignore" })
  if (res.error === undefined && res.status === 0) {
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
  const ids: Array<string> = []
  let plugin = ""
  let enabled = false
  const flush = (): void => {
    if (plugin !== "" && enabled) ids.push(plugin)
  }
  for (const line of readFileSync(configFile, "utf8").split("\n")) {
    const m = /^\[plugins\."([^"]+)"\][ \t]*$/.exec(line)
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

function manualPluginRefreshCommand(sotConfig: string): string {
  const first = enabledPluginIds(sotConfig)[0]
  return first !== undefined ? `codex plugin add ${first}` : "codex plugin add <plugin@marketplace>"
}

function syncPlugins(ctx: Ctx, sotConfig: string): void {
  const { change, echo, warn } = ctx.services.logger
  if (ctx.dryRun) {
    echo("[dry-run] add enabled Codex plugins from SoT")
    return
  }

  if (ctx.services.deps.probe("codex").state === "missing") {
    warn(
      `codex CLI not in PATH - deployed config/marketplace only; install Codex with: ${standaloneInstallCommand(ctx)} | docs: https://developers.openai.com/codex/cli; then run: ${manualPluginRefreshCommand(sotConfig)}`
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

  let refreshed = 0
  let failed = 0
  for (const pluginId of enabledPluginIds(sotConfig)) {
    const res = spawnSync("codex", ["plugin", "add", pluginId], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    const addOut = `${res.stdout ?? ""}${res.stderr ?? ""}`
    if (res.error === undefined && res.status === 0) {
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
