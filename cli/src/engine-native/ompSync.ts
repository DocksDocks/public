/**
 * EngineNative `sync omp` pipeline. config.yml merges through mergeOmpConfig
 * and models.yml through mergeOmpModels. Both preserve user-only keys.
 * Paths come from ompPaths because profiles, PI_CONFIG_DIR,
 * PI_CODING_AGENT_DIR, and XDG roots each move them.
 * Resolution stays within the environment and filesystem probes so no omp
 * subcommand runs under ctx.dryRun.
 *
 * Split: file deploy lives in `ompFileDeploy.ts`, the marketplace pass in
 * `ompMarketplace.ts`, and the plugin pass in `ompPlugins.ts`. This module
 * keeps the orchestration plus the summary surface.
 */
import { isAbsolute, resolve } from "node:path"

import { bunBootstrap } from "./bun"
import { p } from "./exec"
import type { Ctx } from "./index"
import { ompPaths } from "./ompPaths"
import { mergeOmpConfig, mergeOmpModels } from "./ompYaml"
import { ensureDirectory, syncMergedYaml, syncWholeFile } from "./ompFileDeploy"
import { syncMarketplace } from "./ompMarketplace"
import { syncPlugins } from "./ompPlugins"

export interface OmpState {
  readonly pluginsInstalled: number
}

export async function ompSync(ctx: Ctx): Promise<OmpState> {
  await bunBootstrap(ctx, ctx.services)

  const paths = ompPaths({ home: ctx.home, env: process.env, platform: ctx.services.platform.raw() })
  const agentDir = paths.agentDir
  if (!ctx.dryRun) ensureDirectory(agentDir)

  syncWholeFile(ctx, "SoT/.omp/AGENTS.md", p(agentDir, "AGENTS.md"), "omp AGENTS.md already in sync", "omp AGENTS.md synced")
  syncWholeFile(ctx, "SoT/.omp/mcp.json", p(agentDir, "mcp.json"), "omp mcp.json already in sync", "omp mcp.json synced")
  syncMergedYaml(ctx, "SoT/.omp/config.yml", p(agentDir, "config.yml"), mergeOmpConfig)
  syncMergedYaml(ctx, "SoT/.omp/models.yml", p(agentDir, "models.yml"), mergeOmpModels)

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

  const legacyRegistryFile = paths.dataRoot === paths.configRoot
    ? undefined
    : p(paths.configRoot, "marketplaces.json")
  await syncMarketplace(ctx, p(paths.dataRoot, "marketplaces.json"), legacyRegistryFile)
  const pluginsInstalled = await syncPlugins(ctx)
  return { pluginsInstalled }
}

// -------------------------------------------------------------- summary ----

export function ompSummary(ctx: Ctx, state: OmpState): void {
  const { echo } = ctx.services.logger
  const agentDir = ompPaths({ home: ctx.home, env: process.env, platform: ctx.services.platform.raw() }).agentDir
  echo(`omp:      ${agentDir}`)
  if (!ctx.dryRun) echo(`omp plugins: ${state.pluginsInstalled} installed`)
}

export function ompNextSteps(ctx: Ctx): Array<string> {
  return ctx.verbose || ctx.nextStepTriggers.ompRestart
    ? ["Restart omp to load any refreshed plugins, skills, or tools."]
    : []
}
