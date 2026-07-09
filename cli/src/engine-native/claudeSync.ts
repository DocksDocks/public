/**
 * EngineNative `sync claude` pipeline. Step order is load-bearing: rtk BEFORE
 * the settings merge, modifiers after it, removals before plugins. Message
 * strings, guard order, JSON semantics, and spawned argv are golden-tested.
 */
import { spawnSync } from "node:child_process"
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { syncClaudeModel } from "./claudeModel"
import { DEPENDENCIES, warnMissing } from "./deps"
import { capture, commandExists, copyFileIfChanged, copyTreeIfChanged, ensureExecutable, p, writeFileIfChanged } from "./exec"
import { isWindows } from "./os"
import type { Ctx } from "./index"
import { compareCodepoints, deepMerge, isObject, jqStringify, parseJson, type Json } from "./jq"
import { change, echo, err, verbose, warn } from "./logger"
import { ExitError } from "./parseArgs"
import { mergeSettings, reconcileSettings } from "./settings"
import { ensure, field } from "./toolchain"

export function claudeSync(ctx: Ctx): void {
  const claudeDir = p(ctx.home, ".claude")

  if (!ctx.dryRun) mkdirSync(claudeDir, { recursive: true })

  if (!commandExists("claude")) {
    warn(
      `claude CLI not found - config deploys, but plugin passes are skipped. Install Claude Code: ${DEPENDENCIES.claude.installHint()} | docs: https://code.claude.com/docs/en/setup`
    )
  }

  syncRtk(ctx, claudeDir)
  syncScripts(ctx, claudeDir)
  syncHooks(ctx, claudeDir)
  syncClaudeMd(ctx, claudeDir)
  syncSettings(ctx, claudeDir)
  syncCompactWindow(ctx, claudeDir)
  syncPermissive(ctx, claudeDir)
  syncClaudeModel(ctx, ctx.claudeModel)
  syncClaudeJson(ctx)
  syncConnectorEnv(ctx)
  syncRemovals(ctx, claudeDir)
  syncPlugins(ctx, claudeDir)
  syncOptionalPlugins(ctx, claudeDir)
  syncLspServers(ctx)
}

// ------------------------------------------------------------------ rtk ----

/** RTK toolchain install callback. */
export function rtkInstall(ctx: Ctx): (mode: "install" | "upgrade", version: string) => number {
  return (mode, version) => {
    const installerRef = version !== "" ? `refs/tags/v${version}` : "refs/heads/master"

    if (mode === "upgrade") verbose(`Upgrading RTK${version !== "" ? ` to ${version}` : ""}...`)
    else warn(`RTK not found. Installing${version !== "" ? ` ${version}` : ""}...`)
    const installer = p(tmpdir(), `rtk-install-${process.pid}.sh`)
    const dl = spawnSync("curl", ["-fsSL", `https://raw.githubusercontent.com/rtk-ai/rtk/${installerRef}/install.sh`, "-o", installer], {
      stdio: "inherit"
    })
    if (dl.error === undefined && dl.status === 0) {
      spawnSync("bash", [installer], {
        stdio: "inherit",
        env: { ...process.env, RTK_VERSION: version !== "" ? `v${version}` : "" }
      })
    }
    rmSync(installer, { force: true })
    process.env["PATH"] = `${ctx.home}/.local/bin:${ctx.home}/.cargo/bin:${process.env["PATH"] ?? ""}`
    if (commandExists("rtk")) {
      const v = capture("rtk", ["--version"])
      change(`RTK ready (${v !== "" ? v : "version unknown"})`)
      return 0
    }
    err("RTK install failed. Install manually: https://github.com/rtk-ai/rtk")
    return 1
  }
}

function syncRtk(ctx: Ctx, claudeDir: string): void {
  if (ctx.skipRtk) {
    warn("Skipping RTK (--skip-rtk)")
    return
  }

  if (isWindows()) {
    if (!commandExists("rtk")) {
      warn("rtk not installed — the kit's auto-install is Unix-only. Install natively (winget, or the rtk-*-windows-msvc.zip release), then re-run sync")
      return
    }
  } else if (ensure(ctx, "rtk", rtkInstall(ctx)) !== 0) {
    warn("RTK bootstrap failed — continuing sync without it")
  }

  if (!commandExists("rtk")) return
  if (!existsSync(p(claudeDir, "RTK.md"))) {
    if (ctx.dryRun) {
      echo("[dry-run] rtk init --global (RTK.md missing; runs before the settings merge, which normalizes rtk's settings rewrite)")
      return
    }
    // Plain command under bash set -e: a nonzero `rtk init` aborts the whole
    // sync before the success log and before any settings/plugin mutation.
    const res = spawnSync("rtk", ["init", "--global"], { stdio: "inherit" })
    if (res.error !== undefined || res.status !== 0) throw new ExitError(res.status ?? 1)
    change("RTK initialized (RTK.md generated; the following settings merge re-asserts the SoT hooks)")
  } else if (!ctx.dryRun) {
    verbose("RTK already initialized")
  }
}

// ------------------------------------------------------ scripts + hooks ----

function syncScripts(ctx: Ctx, claudeDir: string): void {
  if (ctx.dryRun) {
    echo("[dry-run] cp statusline.sh, fetch-usage.sh, notification.mp3")
    return
  }

  let changed = false
  for (const script of ["statusline.sh", "fetch-usage.sh"]) {
    const src = p(ctx.repoDir, "SoT", ".claude", script)
    if (existsSync(src)) {
      if (copyFileIfChanged(src, p(claudeDir, script))) changed = true
      if (ensureExecutable(p(claudeDir, script))) changed = true
    }
  }
  const mp3 = p(ctx.repoDir, "notification.mp3")
  if (existsSync(mp3) && copyFileIfChanged(mp3, p(claudeDir, "notification.mp3"))) changed = true
  if (changed) {
    change("Scripts synced (statusline, fetch-usage, notification)")
    ctx.nextStepTriggers.claudeRestart = true
  } else verbose("Scripts already in sync (statusline, fetch-usage, notification)")
}

function shellScriptCount(hooksDir: string): number {
  try {
    return readdirSync(hooksDir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".sh")).length
  } catch {
    return 0
  }
}

function syncHooks(ctx: Ctx, claudeDir: string): void {
  const sotHooks = p(ctx.repoDir, "SoT", ".claude", "hooks")
  if (!existsSync(sotHooks)) return

  if (ctx.dryRun) {
    echo(`[dry-run] cp -R ${sotHooks}/. ${claudeDir}/hooks/`)
    return
  }

  const hooksDir = p(claudeDir, "hooks")
  mkdirSync(hooksDir, { recursive: true })
  let changed = copyTreeIfChanged(sotHooks, hooksDir)
  for (const e of readdirSync(hooksDir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".sh")) {
      if (ensureExecutable(p(hooksDir, e.name))) changed = true
    }
  }
  if (changed) {
    change(`Hooks synced (${shellScriptCount(hooksDir)} scripts)`)
    ctx.nextStepTriggers.claudeRestart = true
  } else verbose(`Hooks already in sync (${shellScriptCount(hooksDir)} scripts)`)
}

function syncClaudeMd(ctx: Ctx, claudeDir: string): void {
  // The @RTK.md import only resolves once `rtk init` has generated
  // ~/.claude/RTK.md (the rtk phase runs before this). Deploying the import
  // without the file leaves a dangling reference in every Claude session
  // (seen on Windows, where rtk never auto-installs) — strip it while the
  // file is absent; a later sync after rtk init restores it.
  const rtkMdAbsent = !existsSync(p(claudeDir, "RTK.md"))
  if (ctx.dryRun) {
    if (ctx.skipRtk) {
      echo("[dry-run] cp SoT/.claude/CLAUDE.md -> ~/.claude/CLAUDE.md (stripping @RTK.md import: --skip-rtk)")
    } else if (rtkMdAbsent) {
      echo("[dry-run] cp SoT/.claude/CLAUDE.md -> ~/.claude/CLAUDE.md (would strip @RTK.md import while ~/.claude/RTK.md is absent)")
    } else {
      echo("[dry-run] cp SoT/.claude/CLAUDE.md -> ~/.claude/CLAUDE.md")
    }
    return
  }

  const src = p(ctx.repoDir, "SoT", ".claude", "CLAUDE.md")
  const stripReason = ctx.skipRtk ? "--skip-rtk" : rtkMdAbsent ? "~/.claude/RTK.md absent (rtk not initialized)" : ""
  if (stripReason !== "") {
    const stripped = readFileSync(src, "utf8")
      .split("\n")
      .filter((l) => l !== "@RTK.md")
      .join("\n")
    if (writeFileIfChanged(p(claudeDir, "CLAUDE.md"), stripped)) {
      change(`CLAUDE.md synced (@RTK.md import stripped: ${stripReason})`)
    } else {
      verbose("CLAUDE.md already in sync")
    }
  } else if (copyFileIfChanged(src, p(claudeDir, "CLAUDE.md"))) {
    change("CLAUDE.md synced")
  } else {
    verbose("CLAUDE.md already in sync")
  }
}

// ------------------------------------------------------------- settings ----

function syncSettings(ctx: Ctx, claudeDir: string): void {
  const repoSettings = p(ctx.repoDir, "SoT", ".claude", "settings.json")
  const userSettings = p(claudeDir, "settings.json")

  if (ctx.dryRun) {
    if (!existsSync(userSettings)) {
      echo(`[dry-run] install ${repoSettings} -> ${userSettings}`)
    } else if (ctx.reconcile) {
      echo(`[dry-run] reconcile ${repoSettings} -> ${userSettings} (SoT keys win; permissions arrays replaced; user-only keys preserved)`)
    } else {
      echo(`[dry-run] merge ${repoSettings} -> ${userSettings} (SoT keys win; permissions arrays unioned; user-only keys preserved)`)
    }
    return
  }

  if (!existsSync(userSettings)) {
    copyFileSync(repoSettings, userSettings)
    change("Settings installed")
    ctx.nextStepTriggers.claudeRestart = true
    return
  }

  const user = parseJson(readFileSync(userSettings, "utf8"))
  if (user === undefined) {
    // claude::_settings_validate returns 1 → claude::sync aborts under set -e.
    err(`Skipping settings sync: ${userSettings} is not valid JSON. Fix it manually or delete it to reinstall.`)
    throw new ExitError(1)
  }
  const repo = parseJson(readFileSync(repoSettings, "utf8"))!

  const merged = ctx.reconcile ? reconcileSettings(repo, user) : mergeSettings(repo, user)
  const out = jqStringify(merged)
  if (out === readFileSync(userSettings, "utf8")) {
    verbose("Settings already in sync")
    return
  }
  copyFileSync(userSettings, `${userSettings}.bak`)
  writeFileSync(`${userSettings}.tmp`, out)
  renameSync(`${userSettings}.tmp`, userSettings)
  ctx.nextStepTriggers.claudeRestart = true
  if (ctx.reconcile) {
    change("Settings reconciled (backup at settings.json.bak; user-only keys preserved, permissions arrays replaced by SoT)")
  } else {
    change("Settings merged (backup at settings.json.bak)")
  }
}

/** Shared shape of the three jq-edit modifiers (compact window, permissive). */
function jqEditSettings(claudeDir: string, tag: string, edit: (doc: Json) => void): boolean {
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
  if (ctx.claudeCompactWindow === "") return

  if (ctx.dryRun) {
    echo(`[dry-run] (--claude-compact-window) set env.CLAUDE_CODE_AUTO_COMPACT_WINDOW=${ctx.claudeCompactWindow} in ${p(claudeDir, "settings.json")}`)
    return
  }

  const changed = jqEditSettings(claudeDir, "--claude-compact-window", (doc) => {
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
  if (!ctx.claudePermissive) return

  if (ctx.dryRun) {
    echo(`[dry-run] (--claude-permissive) empty permissions.ask and permissions.deny in ${p(claudeDir, "settings.json")}`)
    return
  }

  const changed = jqEditSettings(claudeDir, "--claude-permissive", (doc) => {
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
  const claudeJson = p(ctx.home, ".claude.json")
  const mcpSot = p(ctx.repoDir, "SoT", ".claude", "mcp-servers.json")

  let mcp: Json | undefined
  if (existsSync(mcpSot)) mcp = parseJson(readFileSync(mcpSot, "utf8"))
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
    if (doc === undefined) {
      err("Skipping ~/.claude.json edit: not valid JSON. Fix or delete it.")
      return
    }
    const obj = isObject(doc) ? doc : {}
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

function syncConnectorEnv(ctx: Ctx): void {
  // win32: Claude Code launches from PowerShell/GUI, so the flag must be a
  // real user env var (setx), not a Git-Bash-only shell-rc export. Never
  // clobbers an existing value (set =true yourself to keep connectors).
  if (isWindows()) {
    const existing = spawnSync("reg", ["query", "HKCU\\Environment", "/v", "ENABLE_CLAUDEAI_MCP_SERVERS"], {
      stdio: "ignore"
    })
    if (existing.error === undefined && existing.status === 0) {
      if (ctx.dryRun) echo("[dry-run] ENABLE_CLAUDEAI_MCP_SERVERS already in user environment — would skip")
      else verbose("claude.ai connectors: ENABLE_CLAUDEAI_MCP_SERVERS already set in user environment (left as-is)")
      return
    }
    if (ctx.dryRun) {
      echo("[dry-run] setx ENABLE_CLAUDEAI_MCP_SERVERS false (user environment)")
      return
    }
    const res = spawnSync("setx", ["ENABLE_CLAUDEAI_MCP_SERVERS", "false"], { stdio: "ignore" })
    if (res.error === undefined && res.status === 0) {
      change("claude.ai connectors disabled via setx (open a new terminal to apply)")
      ctx.nextStepTriggers.claudeRestart = true
    } else {
      warn("setx ENABLE_CLAUDEAI_MCP_SERVERS false failed — set it manually in System Properties > Environment Variables")
    }
    return
  }

  const line = "export ENABLE_CLAUDEAI_MCP_SERVERS=false"
  const marker = "# docks-kit: disable claude.ai cloud MCP connectors (set =true to keep them)"
  const candidates = [".zshrc", ".bashrc", ".bash_profile", ".profile", ".zshenv"].map((f) => p(ctx.home, f))

  for (const f of candidates) {
    if (existsSync(f) && readFileSync(f, "utf8").includes("ENABLE_CLAUDEAI_MCP_SERVERS")) {
      if (ctx.dryRun) {
        echo(`[dry-run] ENABLE_CLAUDEAI_MCP_SERVERS already in ${f} — would skip`)
      } else {
        verbose(`claude.ai connectors: ENABLE_CLAUDEAI_MCP_SERVERS already set in ${f} (left as-is)`)
      }
      return
    }
  }

  const shell = process.env["SHELL"] ?? "bash"
  const shellName = shell.slice(shell.lastIndexOf("/") + 1)
  const target = shellName === "zsh" ? p(ctx.home, ".zshrc") : shellName === "bash" ? p(ctx.home, ".bashrc") : p(ctx.home, ".profile")

  if (ctx.dryRun) {
    echo(`[dry-run] append 'export ENABLE_CLAUDEAI_MCP_SERVERS=false' to ${target}`)
    return
  }

  appendFileSync(target, `\n${marker}\n${line}\n`)
  change(`claude.ai connectors disabled via ${target} (start a new shell to apply)`)
  ctx.nextStepTriggers.claudeRestart = true
}

// ------------------------------------------------------------- removals ----

const REMOVED_MANIFEST = {
  hooks: ["disable-claudeai-connectors.sh"],
  files: ["alert_bubble.mp3"],
  settingsKeys: [
    "showTurnDuration",
    "env.CLAUDE_CODE_SUBAGENT_MODEL",
    "env.ANTHROPIC_DEFAULT_OPUS_MODEL",
    "env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE",
    "env.CLAUDE_CODE_DISABLE_1M_CONTEXT",
    "env.CLAUDE_CODE_FORK_SUBAGENT",
    "env.CLAUDE_CODE_EFFORT_LEVEL"
  ],
  claudeJsonKeys: [] as Array<string>
}

/** claude::_prune_json_keys — present-count; deletes when !dryRun. */
function pruneJsonKeys(ctx: Ctx, file: string, keys: Array<string>): number {
  if (keys.length === 0 || !existsSync(file)) return 0
  const doc = parseJson(readFileSync(file, "utf8"))
  if (doc === undefined) return 0

  const getPath = (root: Json, path: Array<string>): Json | undefined => {
    let cur: Json | undefined = root
    for (const seg of path) {
      if (cur === undefined || !isObject(cur)) return undefined
      cur = cur[seg]
    }
    return cur
  }
  const presentKeys = keys.filter((k) => {
    const v = getPath(doc, k.split("."))
    return v !== undefined && v !== null
  })
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

function syncRemovals(ctx: Ctx, claudeDir: string): void {
  let hooksRemoved = 0
  let filesRemoved = 0

  for (const name of REMOVED_MANIFEST.hooks) {
    const path = p(claudeDir, "hooks", name)
    if (!existsSync(path)) continue
    if (ctx.dryRun) {
      echo(`[dry-run] rm ${path}`)
    } else {
      rmSync(path, { force: true })
      hooksRemoved++
    }
  }

  for (const rel of REMOVED_MANIFEST.files) {
    const path = p(claudeDir, rel)
    if (!existsSync(path)) continue
    if (ctx.dryRun) {
      echo(`[dry-run] rm ${path}`)
    } else {
      rmSync(path, { force: true })
      filesRemoved++
    }
  }

  const skeys = pruneJsonKeys(ctx, p(claudeDir, "settings.json"), REMOVED_MANIFEST.settingsKeys)
  const cjkeys = pruneJsonKeys(ctx, p(ctx.home, ".claude.json"), REMOVED_MANIFEST.claudeJsonKeys)

  if (ctx.dryRun) {
    if (skeys > 0) echo(`[dry-run] del ${skeys} stale key(s) from ${p(claudeDir, "settings.json")}`)
    if (cjkeys > 0) echo(`[dry-run] del ${cjkeys} stale key(s) from ${p(ctx.home, ".claude.json")}`)
    return
  }

  if (hooksRemoved + filesRemoved + skeys + cjkeys > 0) {
    change(`Pruned stale artifacts (hooks: ${hooksRemoved}, files: ${filesRemoved}, settings keys: ${skeys}, claude.json keys: ${cjkeys})`)
    ctx.nextStepTriggers.claudeRestart = true
  }
}

// -------------------------------------------------------------- plugins ----

function cli(args: Array<string>): { ok: boolean; out: string } {
  const res = spawnSync("claude", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  return { ok: res.error === undefined && res.status === 0, out: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

function readJsonFile(file: string): Json | undefined {
  return existsSync(file) ? parseJson(readFileSync(file, "utf8")) : undefined
}

function sortedKeys(obj: Json | undefined): Array<string> {
  return obj !== undefined && isObject(obj) ? Object.keys(obj).sort(compareCodepoints) : []
}

/** claude::_plugin_user_scope_installed. */
function pluginUserScopeInstalled(installedPlugins: string, pluginId: string): boolean {
  const doc = readJsonFile(installedPlugins)
  if (doc === undefined || !isObject(doc) || !isObject(doc["plugins"])) return false
  const rec = (doc["plugins"] as { [k: string]: Json })[pluginId]
  if (rec === undefined || rec === null) return false
  const records = Array.isArray(rec) ? rec : [rec]
  return records.some((r) => isObject(r) && r["scope"] === "user")
}

function syncPlugins(ctx: Ctx, claudeDir: string): void {
  const repoSettingsFile = p(ctx.repoDir, "SoT", ".claude", "settings.json")
  const knownMarketplaces = p(claudeDir, "plugins", "known_marketplaces.json")
  const installedPlugins = p(claudeDir, "plugins", "installed_plugins.json")

  if (ctx.dryRun) {
    echo("[dry-run] bootstrap + update plugin marketplaces + plugins from SoT")
    if (ctx.prune) {
      echo("[dry-run] (--prune) would also uninstall plugins not in SoT and remove extra marketplaces")
    }
    return
  }

  if (!commandExists("claude")) {
    warn("claude CLI not in PATH — skipping plugin reconcile (run /plugin marketplace add + /plugin install manually)")
    return
  }
  if (!commandExists("git")) {
    warnMissing("git", "plugin marketplaces are git repos — Claude plugin passes skipped; re-run sync after installing")
    return
  }

  const repoSettings = readJsonFile(repoSettingsFile)
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
    if (cli(["plugin", "marketplace", "add", repo]).ok) {
      addedMp++
    } else {
      warn(`Failed to add marketplace: ${mpName} (${repo})`)
      f1++
    }
  }

  // Pass 2 — install SoT-enabled plugins missing at user scope (jq keys[] sorts).
  let addedPl = 0
  let f2 = 0
  let refreshed = false
  for (const pluginId of sortedKeys(sotPlugins)) {
    if (pluginUserScopeInstalled(installedPlugins, pluginId)) continue
    if (!refreshed) {
      cli(["plugin", "marketplace", "update"])
      refreshed = true
    }
    if (cli(["plugin", "install", pluginId]).ok) {
      addedPl++
    } else {
      warn(`Failed to install plugin: ${pluginId}`)
      f2++
    }
  }

  // Pass 3 — refresh every installed plugin.
  cli(["plugin", "marketplace", "update"])
  let updatedPl = 0
  const installedDoc = readJsonFile(installedPlugins)
  const installedKeys = installedDoc !== undefined && isObject(installedDoc) ? sortedKeys(installedDoc["plugins"]) : []
  for (const pluginId of installedKeys) {
    if (cli(["plugin", "update", pluginId]).out.includes("Successfully updated")) updatedPl++
  }

  // Passes 4 + 5 — prune-gated uninstall + marketplace removal.
  let removedPl = 0
  let removedMp = 0
  let f4 = 0
  let f5 = 0
  if (ctx.prune) {
    for (const pluginId of installedKeys) {
      if (isObject(sotPlugins) && Object.prototype.hasOwnProperty.call(sotPlugins, pluginId)) continue
      if (!pluginUserScopeInstalled(installedPlugins, pluginId)) continue
      if (cli(["plugin", "uninstall", "-y", "--scope", "user", pluginId]).ok) {
        removedPl++
      } else {
        warn(`Failed to uninstall plugin: ${pluginId}`)
        f4++
      }
    }
    const known = readJsonFile(knownMarketplaces)
    for (const mpName of sortedKeys(known)) {
      if (mpName === "claude-plugins-official") continue
      const declared = isObject(sotMarketplaces) ? sotMarketplaces[mpName] : undefined
      if (declared !== undefined && declared !== null && declared !== false) continue
      if (cli(["plugin", "marketplace", "remove", mpName]).ok) {
        removedMp++
      } else {
        warn(`Failed to remove marketplace: ${mpName}`)
        f5++
      }
    }
  }

  // Pass 6 — re-assert SoT enabled-state in the user settings.
  if (reassertEnabledState(repoObj, p(claudeDir, "settings.json"))) {
    change("Plugin enable-state re-asserted from SoT in settings.json")
    ctx.nextStepTriggers.claudePlugins = true
  }

  const failed = f1 + f2 + f4 + f5
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

function reassertEnabledState(repoObj: { [k: string]: Json }, userSettingsFile: string): boolean {
  if (!existsSync(userSettingsFile)) return false
  const sotPlugins = isObject(repoObj["enabledPlugins"]) ? repoObj["enabledPlugins"] : {}

  for (const [pluginId, value] of Object.entries(sotPlugins)) {
    if (value !== false) continue
    const user = readJsonFile(userSettingsFile)
    const enabled = user !== undefined && isObject(user) && isObject(user["enabledPlugins"]) ? (user["enabledPlugins"] as { [k: string]: Json })[pluginId] : undefined
    if (enabled !== true) continue
    if (!cli(["plugin", "disable", pluginId]).ok) {
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
  if (out === beforeCanonical) return false
  writeFileSync(`${userSettingsFile}.tmp`, out)
  renameSync(`${userSettingsFile}.tmp`, userSettingsFile)
  return true
}

// ------------------------------------------------------ optional plugins ----

function enableOptionalPlugin(claudeDir: string, pluginId: string, marketplaceRepo: string): boolean {
  const installedPlugins = p(claudeDir, "plugins", "installed_plugins.json")
  const knownMarketplaces = p(claudeDir, "plugins", "known_marketplaces.json")
  const mpName = pluginId.slice(pluginId.lastIndexOf("@") + 1)

  let marketplaceAdded = false
  if (marketplaceRepo !== "") {
    const known = readJsonFile(knownMarketplaces)
    const has = known !== undefined && isObject(known) && known[mpName] !== undefined && known[mpName] !== null && known[mpName] !== false
    if (!has) {
      if (!cli(["plugin", "marketplace", "add", marketplaceRepo]).ok) {
        warn(`Failed to add marketplace ${marketplaceRepo} for ${pluginId}`)
        return false
      }
      marketplaceAdded = true
    }
  }

  const wasInstalled = pluginUserScopeInstalled(installedPlugins, pluginId)
  if (!wasInstalled) {
    if (!cli(["plugin", "install", pluginId]).ok) {
      warn(`Failed to install optional plugin ${pluginId}`)
      return marketplaceAdded
    }
  }

  const settingsDoc = readJsonFile(p(claudeDir, "settings.json"))
  const wasEnabled =
    settingsDoc !== undefined && isObject(settingsDoc) && isObject(settingsDoc["enabledPlugins"])
      ? (settingsDoc["enabledPlugins"] as { [k: string]: Json })[pluginId] === true
      : false

  if (!cli(["plugin", "enable", pluginId]).ok) {
    warn(`Failed to enable optional plugin ${pluginId}`)
    return marketplaceAdded || !wasInstalled
  }
  const changed = marketplaceAdded || !wasInstalled || !wasEnabled
  if (changed) change(`Optional plugin opted in: ${pluginId}`)
  else verbose(`Optional plugin already opted in: ${pluginId} (enable re-asserted)`)
  return changed
}

function syncOptionalPlugins(ctx: Ctx, claudeDir: string): void {
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

  if (!commandExists("claude")) {
    warn("claude CLI not in PATH — cannot opt in optional plugins (--claude-plugin)")
    return
  }

  if (ctx.claudePlugins.includes("supabase")) {
    if (enableOptionalPlugin(claudeDir, "supabase@claude-plugins-official", "")) ctx.nextStepTriggers.claudePlugins = true
  }
  if (ctx.claudePlugins.includes("n8n")) {
    if (enableOptionalPlugin(claudeDir, "n8n-mcp-skills@n8n-mcp-skills", "czlonkowski/n8n-skills")) ctx.nextStepTriggers.claudePlugins = true
  }
}

// ---------------------------------------------------------- LSP servers ----

function lspPkg(ctx: Ctx, tool: string, pkg: string): string {
  const v = field(ctx, tool, "verified")
  return v !== "" ? `${pkg}@${v}` : pkg
}

function syncLspServers(ctx: Ctx): void {
  const sot = readJsonFile(p(ctx.repoDir, "SoT", ".claude", "settings.json"))
  const enabled = sot !== undefined && isObject(sot) && isObject(sot["enabledPlugins"]) ? sot["enabledPlugins"] : undefined
  if (enabled === undefined) return
  const hasPhp = Object.prototype.hasOwnProperty.call(enabled, "php-lsp@claude-plugins-official")
  const hasTs = Object.prototype.hasOwnProperty.call(enabled, "typescript-lsp@claude-plugins-official")
  if (!hasPhp && !hasTs) return

  const missing: Array<string> = []
  if (hasPhp && !commandExists("intelephense")) missing.push(lspPkg(ctx, "intelephense", "intelephense"))
  if (hasTs) {
    if (!commandExists("typescript-language-server")) missing.push(lspPkg(ctx, "typescript-language-server", "typescript-language-server"))
    if (!commandExists("tsc")) missing.push(lspPkg(ctx, "tsc", "typescript"))
  }

  if (missing.length === 0) {
    if (ctx.dryRun) {
      echo("[dry-run] LSP server binaries present")
    } else {
      verbose("LSP server binaries present")
    }
    return
  }

  const specs = missing.join(" ")
  if (ctx.dryRun) {
    echo(`[dry-run] would install: npm install -g ${specs}`)
    return
  }

  if (!commandExists("npm")) {
    warnMissing("npm", `cannot install LSP servers (${specs}); the php-lsp/typescript-lsp plugins stay no-ops`)
    return
  }

  verbose(`Installing LSP servers via npm: ${specs}...`)
  if (spawnSync("npm", ["install", "-g", ...missing], { stdio: "ignore" }).status === 0) {
    change(`LSP servers installed (${specs})`)
    ctx.nextStepTriggers.claudeRestart = true
  } else {
    warn(`npm install -g ${specs} failed. Try manually: npm install -g ${specs}`)
  }
}

// -------------------------------------------------------------- summary ----

export function claudeSummary(ctx: Ctx): void {
  const claudeDir = p(ctx.home, ".claude")
  echo(`Claude:   ${claudeDir}`)
  if (!ctx.dryRun) {
    echo(`Hooks:    ${shellScriptCount(p(claudeDir, "hooks"))} scripts`)
    if (commandExists("rtk")) {
      const v = capture("rtk", ["--version"])
      echo(`RTK:      ${v !== "" ? v : "installed"}`)
    } else {
      echo("RTK:      not installed")
    }
    if (commandExists("claude")) {
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
