/**
 * EngineNative omp plugin pass: marketplace-plugin install/upgrade plus the
 * pinned pi-intercom npm plugin. Split from ompSync.ts; the orchestration
 * still lives there.
 */
import { spawnProcess } from "./exec"
import { recordFailure } from "./failures"
import type { Ctx } from "./index"
import { isObject, parseJson } from "./jq"
import { firstOutputLine } from "./ompMarketplace"
import { field } from "./toolchain"

const MARKETPLACE_PLUGIN_IDS = ["docks@docks", "plan-lifecycle@docks"] as const

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
  // is already the token `omp plugin install/upgrade` takes. omp emits one row
  // per scope holding the plugin, so a match found only in a `project` row
  // means the user scope is empty and `upgrade --scope user` would fail; only a
  // `user` row counts as installed for this pipeline.
  const marketplace = new Set<string>()
  for (const row of value["marketplace"]) {
    if (!isObject(row) || typeof row["id"] !== "string" || row["scope"] !== "user") continue
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
  const { clearProgress, progress } = ctx.services.logger
  progress(`Updating omp plugin ${plugin}...`)
  const result = await spawnProcess("omp", args, { stdio: ["ignore", "pipe", "pipe"] })
  clearProgress()
  if (result.error === undefined && result.exitCode === 0) return true

  recordFailure(
    ctx,
    `omp plugin operation failed for ${plugin}: ${firstOutputLine(result)}; run manually: omp ${args.join(" ")}`
  )
  return false
}

export async function syncPlugins(ctx: Ctx): Promise<number> {
  const { change, clearProgress, echo, progress, verbose, warn } = ctx.services.logger

  if (ctx.dryRun) {
    const piIntercomPin = field("pi-intercom", "verified")
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
  const piIntercomPin = field("pi-intercom", "verified")

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
