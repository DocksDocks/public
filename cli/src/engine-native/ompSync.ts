/**
 * EngineNative `sync omp` pipeline. config.yml merges through
 * mergeOmpConfig because omp serialises that file itself. No omp subcommand
 * runs under ctx.dryRun because `omp plugin marketplace add --dry-run`
 * performs the write.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"

import { payloadDisplayPath, payloadText, type PayloadPath } from "../payload"
import { bunBootstrap } from "./bun"
import { commandExists, p, spawnProcess, type AsyncProcessResult } from "./exec"
import type { Ctx } from "./index"
import { isObject, parseJson } from "./jq"
import { mergeOmpConfig } from "./ompYaml"
import { field } from "./toolchain"

const MARKETPLACE_NAME = "docks"
const MARKETPLACE_SOURCE = "https://github.com/DocksDocks/docks.git"
const MARKETPLACE_PLUGIN_IDS = ["docks@docks", "plan-lifecycle@docks"] as const
type OmpTextPayloadPath = Extract<PayloadPath, `SoT/.omp/${string}`>

export interface OmpState {
  readonly pluginsInstalled: number
}

export async function ompSync(ctx: Ctx): Promise<OmpState> {
  await bunBootstrap(ctx, ctx.services)

  const agentDir = p(ctx.home, ".omp", "agent")
  if (!ctx.dryRun) ensureDirectory(agentDir)

  syncWholeFile(ctx, "SoT/.omp/AGENTS.md", p(agentDir, "AGENTS.md"), "omp AGENTS.md already in sync", "omp AGENTS.md synced")
  syncWholeFile(ctx, "SoT/.omp/mcp.json", p(agentDir, "mcp.json"), "omp mcp.json already in sync", "omp mcp.json synced")
  syncConfig(ctx, p(agentDir, "config.yml"))

  const intercomRootSetting = process.env["PI_CODING_AGENT_DIR"]
  const intercomRoot = intercomRootSetting !== undefined && intercomRootSetting !== ""
    ? isAbsolute(intercomRootSetting)
      ? intercomRootSetting
      : resolve(process.cwd(), intercomRootSetting)
    : p(ctx.home, ".pi", "agent")
  const intercomDir = p(intercomRoot, "intercom")
  if (!ctx.dryRun) ensureDirectory(intercomDir)
  syncWholeFile(
    ctx,
    "SoT/.omp/intercom.json",
    p(intercomDir, "config.json"),
    "omp intercom configuration already in sync",
    "omp intercom configuration synced"
  )

  await syncMarketplace(ctx, p(ctx.home, ".omp", "marketplaces.json"))
  const pluginsInstalled = await syncPlugins(ctx)
  return { pluginsInstalled }
}

// ------------------------------------------------------------ file modes ----

/**
 * `mkdirSync` and `writeFileSync` apply their `mode` only when they create the
 * path, so an existing world-readable directory or file would keep its mode.
 * The explicit chmod reproduces `install -d -m 0700` / `install -m 0600`.
 */
function ensureDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
}

function writePrivateFile(target: string, content: string): void {
  writeFileSync(target, content, { mode: 0o600 })
  chmodSync(target, 0o600)
}

function backupPrivateFile(target: string): void {
  copyFileSync(target, `${target}.bak`)
  chmodSync(`${target}.bak`, 0o600)
}

// --------------------------------------------------------------- config ----

function syncWholeFile(
  ctx: Ctx,
  sourcePath: OmpTextPayloadPath,
  target: string,
  alreadyMessage: string,
  syncedMessage: string
): void {
  const { change, echo, verbose } = ctx.services.logger
  const source = payloadDisplayPath(sourcePath)
  const content = payloadText(sourcePath)

  if (ctx.dryRun) {
    echo(`[dry-run] cp ${source} -> ${target}`)
    return
  }

  if (existsSync(target) && readFileSync(target, "utf8") === content) {
    verbose(alreadyMessage)
    return
  }
  if (existsSync(target)) backupPrivateFile(target)
  writePrivateFile(target, content)
  change(syncedMessage)
  ctx.nextStepTriggers.ompRestart = true
}

function syncConfig(ctx: Ctx, target: string): void {
  const { change, echo, verbose } = ctx.services.logger
  const source = payloadDisplayPath("SoT/.omp/config.yml")
  const sotText = payloadText("SoT/.omp/config.yml")

  if (!existsSync(target)) {
    if (ctx.dryRun) {
      echo(`[dry-run] cp ${source} -> ${target}`)
      return
    }
    writePrivateFile(target, sotText)
    change("omp config.yml installed")
    ctx.nextStepTriggers.ompRestart = true
    return
  }

  const deployedText = readFileSync(target, "utf8")
  const merged = mergeOmpConfig(sotText, deployedText)
  if (merged === deployedText) {
    verbose("omp config.yml already in sync")
    return
  }
  if (ctx.dryRun) {
    echo(`[dry-run] merge ${source} -> ${target} (backup at ${target}.bak)`)
    return
  }

  backupPrivateFile(target)
  writePrivateFile(`${target}.tmp`, merged)
  renameSync(`${target}.tmp`, target)
  chmodSync(target, 0o600)
  change("omp config.yml merged (backup at config.yml.bak)")
  ctx.nextStepTriggers.ompRestart = true
}

// ---------------------------------------------------------- marketplace ----

function registryHasDocks(registryFile: string): boolean {
  if (!existsSync(registryFile)) return false

  let registryText: string
  try {
    registryText = readFileSync(registryFile, "utf8")
  } catch {
    return false
  }
  const registry = parseJson(registryText)
  if (registry === undefined) return false
  if (isObject(registry) && Object.hasOwn(registry, MARKETPLACE_NAME)) return true

  const entries = Array.isArray(registry)
    ? registry
    : isObject(registry) && Array.isArray(registry["marketplaces"])
      ? registry["marketplaces"]
      : []
  return entries.some((entry) => isObject(entry) && entry["name"] === MARKETPLACE_NAME)
}

function firstOutputLine(result: AsyncProcessResult): string {
  const output = `${result.stdout}${result.stderr}`
  return output.split("\n")[0] || "unknown error"
}

async function syncMarketplace(ctx: Ctx, registryFile: string): Promise<void> {
  const { change, clearProgress, echo, progress, verbose, warn } = ctx.services.logger
  const registered = registryHasDocks(registryFile)

  if (ctx.dryRun) {
    if (registered) verbose("omp docks marketplace already registered")
    else echo(`[dry-run] omp plugin marketplace add ${MARKETPLACE_SOURCE}`)
    return
  }

  if (!registered) {
    progress("Registering omp docks marketplace...")
    const result = await spawnProcess("omp", ["plugin", "marketplace", "add", MARKETPLACE_SOURCE], {
      stdio: ["ignore", "pipe", "pipe"]
    })
    clearProgress()
    if (result.error === undefined && result.exitCode === 0) {
      change("omp docks marketplace registered")
    } else {
      warn(
        `omp docks marketplace registration failed: ${firstOutputLine(result)}; run manually: omp plugin marketplace add ${MARKETPLACE_SOURCE}`
      )
    }
    return
  }

  if (ctx.skipPluginRefresh === true) {
    verbose("omp docks marketplace already registered; refresh-only update skipped")
    return
  }

  progress("Updating omp docks marketplace...")
  const result = await spawnProcess("omp", ["plugin", "marketplace", "update", MARKETPLACE_NAME], {
    stdio: ["ignore", "pipe", "pipe"]
  })
  clearProgress()
  if (result.error === undefined && result.exitCode === 0) {
    verbose("omp docks marketplace refreshed")
  } else {
    warn(
      `omp docks marketplace update failed: ${firstOutputLine(result)}; run manually: omp plugin marketplace update ${MARKETPLACE_NAME}`
    )
  }
}

// -------------------------------------------------------------- plugins ----

interface InstalledPlugins {
  readonly marketplace: Set<string>
  readonly npm: Map<string, string>
}

async function installedPluginIdsFromCli(): Promise<InstalledPlugins | undefined> {
  const result = await spawnProcess("omp", ["plugin", "list", "--json"], {
    stdio: ["ignore", "pipe", "ignore"]
  })
  if (result.error !== undefined || result.exitCode !== 0) return undefined

  const value = parseJson(result.stdout)
  if (
    value === undefined ||
    !isObject(value) ||
    !Array.isArray(value["marketplace"]) ||
    !Array.isArray(value["npm"])
  ) {
    return undefined
  }

  // `omp plugin list --json` reports marketplace rows as
  // `{ id: "<plugin>@<marketplace>", scope, entries: [...] }` - the composite id
  // is already the token `omp plugin install/upgrade` takes.
  const marketplace = new Set<string>()
  for (const row of value["marketplace"]) {
    if (!isObject(row) || typeof row["id"] !== "string") continue
    marketplace.add(row["id"])
  }

  const npm = new Map<string, string>()
  for (const row of value["npm"]) {
    if (!isObject(row) || typeof row["name"] !== "string" || typeof row["version"] !== "string") continue
    npm.set(row["name"], row["version"])
  }
  return { marketplace, npm }
}

async function runPluginCommand(
  ctx: Ctx,
  plugin: string,
  args: ReadonlyArray<string>
): Promise<boolean> {
  const { clearProgress, progress, warn } = ctx.services.logger
  progress(`Updating omp plugin ${plugin}...`)
  const result = await spawnProcess("omp", args, { stdio: ["ignore", "pipe", "pipe"] })
  clearProgress()
  if (result.error === undefined && result.exitCode === 0) return true

  warn(
    `omp plugin operation failed for ${plugin}: ${firstOutputLine(result)}; run manually: omp ${args.join(" ")}`
  )
  return false
}

async function syncPlugins(ctx: Ctx): Promise<number> {
  const { change, clearProgress, echo, progress, verbose, warn } = ctx.services.logger

  if (ctx.dryRun) {
    const piIntercomPin = field(ctx, "pi-intercom", "verified")
    for (const pluginId of MARKETPLACE_PLUGIN_IDS) {
      echo(`[dry-run] omp plugin install --scope user ${pluginId}`)
    }
    if (piIntercomPin === "") {
      warn("pi-intercom install skipped because SoT/toolchain.json has no verified pi-intercom pin")
    } else {
      echo(`[dry-run] omp install pi-intercom@${piIntercomPin}`)
    }
    return 0
  }

  if (ctx.services.deps.probe("omp").state === "missing") {
    ctx.services.deps.warnMissing(
      "omp",
      ctx.services.logger,
      "deployed omp config only — marketplace and plugin passes skipped; re-run sync after installing"
    )
    return 0
  }
  if (ctx.services.deps.probe("git").state === "missing") {
    ctx.services.deps.warnMissing(
      "git",
      ctx.services.logger,
      "plugin marketplaces are git repos — omp plugin refresh skipped; re-run sync after installing"
    )
    return 0
  }
  const piIntercomPin = field(ctx, "pi-intercom", "verified")

  progress("Checking installed omp plugins...")
  const installed = await installedPluginIdsFromCli()
  clearProgress()
  if (installed === undefined) {
    warn("omp plugin inventory unavailable — falling back to the full refresh path")
  }

  let pluginsInstalled = installed === undefined
    ? 0
    : MARKETPLACE_PLUGIN_IDS.filter((pluginId) => installed.marketplace.has(pluginId)).length +
      (piIntercomPin !== "" && installed.npm.has("pi-intercom") ? 1 : 0)
  let operationsSucceeded = 0

  for (const pluginId of MARKETPLACE_PLUGIN_IDS) {
    const present = installed?.marketplace.has(pluginId) === true
    if (present && ctx.skipPluginRefresh === true) {
      verbose(`omp plugin ${pluginId} already installed; refresh-only update skipped`)
      continue
    }

    const args = present
      ? ["plugin", "upgrade", "--scope", "user", pluginId]
      : ["plugin", "install", "--scope", "user", pluginId]
    if (await runPluginCommand(ctx, pluginId, args)) {
      operationsSucceeded++
      if (!present) pluginsInstalled++
    }
  }

  if (piIntercomPin === "") {
    warn("pi-intercom install skipped because SoT/toolchain.json has no verified pi-intercom pin")
  } else {
    const installedVersion = installed?.npm.get("pi-intercom")
    const present = installedVersion !== undefined
    if (installedVersion === piIntercomPin) {
      verbose(`omp npm plugin pi-intercom already installed at ${piIntercomPin}`)
    } else if (present && ctx.skipPluginRefresh === true) {
      verbose("omp npm plugin pi-intercom already installed; refresh-only update skipped")
    } else {
      const args = present
        ? ["install", "--force", `pi-intercom@${piIntercomPin}`]
        : ["install", `pi-intercom@${piIntercomPin}`]
      if (await runPluginCommand(ctx, "pi-intercom", args)) {
        operationsSucceeded++
        if (!present) pluginsInstalled++
      }
    }
  }

  if (operationsSucceeded > 0) {
    change(`omp plugins synced (plugins: ~${operationsSucceeded})`)
    ctx.nextStepTriggers.ompRestart = true
  } else {
    verbose("omp plugins already in sync")
  }
  return pluginsInstalled
}

// -------------------------------------------------------------- summary ----

export function ompSummary(ctx: Ctx, state: OmpState): void {
  const { echo } = ctx.services.logger
  const agentDir = p(ctx.home, ".omp", "agent")
  echo(`omp:      ${agentDir}`)
  if (!ctx.dryRun) echo(`omp plugins: ${state.pluginsInstalled} installed`)
}

export function ompNextSteps(ctx: Ctx): Array<string> {
  return ctx.verbose || ctx.nextStepTriggers.ompRestart
    ? ["Restart omp to load any refreshed plugins, skills, or tools."]
    : []
}
