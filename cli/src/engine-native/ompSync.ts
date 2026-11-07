/**
 * EngineNative `sync omp` pipeline. config.yml merges through mergeOmpConfig
 * and models.yml through mergeOmpModels. Both preserve user-only keys.
 * Paths come from ompPaths because profiles, PI_CONFIG_DIR,
 * PI_CODING_AGENT_DIR, and XDG roots each move them. `runSync` resolves them
 * once, before it takes the folder locks, and the pipeline writes only there.
 * Resolution stays within the environment and filesystem probes so no omp
 * subcommand runs under ctx.dryRun.
 *
 * Split: file deploy lives in `ompFileDeploy.ts`, the kit plugin files in
 * `ompKitPlugin.ts`, the marketplace pass in `ompMarketplace.ts`, the plugin
 * pass in `ompPlugins.ts`, and the retired-key prune in `ompRemovals.ts`.
 * This module keeps the orchestration plus the summary surface.
 */
import { isAbsolute, resolve } from "node:path";

import { bunBootstrap } from "./bun";
import { p } from "./exec";
import { recordFailure } from "./failures";
import type { Ctx } from "./index";
import { ompPaths, type OmpPaths } from "./ompPaths";
import { mergeOmpConfig, mergeOmpModels } from "./ompYaml";
import { ensureDirectory, syncMergedYaml, syncWholeFile } from "./ompFileDeploy";
import { syncKitPlugin } from "./ompKitPlugin";
import { syncMarketplace } from "./ompMarketplace";
import { syncPlugins } from "./ompPlugins";
import { syncOmpModelRemovals, syncOmpRemovals } from "./ompRemovals";

export interface OmpState {
  readonly pluginsInstalled: number;
  /** The omp agent folder that the sync wrote. */
  readonly agentDir: string;
}

/** The omp folders that a sync writes. */
export interface OmpWriteFolders {
  readonly paths: OmpPaths;
  /** The folder of the pi-intercom `config.json`. */
  readonly intercomDir: string;
}

/**
 * Resolve the omp paths and the intercom folder of this run. `runSync` calls
 * it once, takes a folder lock in each folder, and gives the result to
 * `ompSync`. A second resolution could pick an XDG data root that another
 * sync created after the locks.
 */
export function ompWriteFolders(ctx: Ctx): OmpWriteFolders {
  const paths = ompPaths({
    home: ctx.home,
    env: process.env,
    platform: ctx.services.platform.raw(),
  });
  // omp exports PI_CODING_AGENT_DIR as the agent directory of a named profile,
  // and pi-intercom reads the trimmed value. Without a profile, the kit uses
  // the PI_CODING_AGENT_DIR value when it is set, else ~/.pi/agent.
  const intercomRootSetting = process.env["PI_CODING_AGENT_DIR"]?.trim();
  const intercomRoot =
    paths.profile !== undefined
      ? paths.agentDir
      : intercomRootSetting !== undefined && intercomRootSetting !== ""
        ? isAbsolute(intercomRootSetting)
          ? intercomRootSetting
          : resolve(process.cwd(), intercomRootSetting)
        : p(ctx.home, ".pi", "agent");
  return { paths, intercomDir: p(intercomRoot, "intercom") };
}

/** Run the omp pipeline in `folders`, the folders that `runSync` resolved and locked. */
export async function ompSync(ctx: Ctx, folders: OmpWriteFolders): Promise<OmpState> {
  await bunBootstrap(ctx, ctx.services);

  const { paths, intercomDir } = folders;
  const agentDir = paths.agentDir;
  if (!ctx.dryRun) ensureDirectory(agentDir);

  syncWholeFile(
    ctx,
    "SoT/.omp/AGENTS.md",
    p(agentDir, "AGENTS.md"),
    "omp AGENTS.md already in sync",
    "omp AGENTS.md synced",
  );
  syncWholeFile(
    ctx,
    "SoT/.omp/mcp.json",
    p(agentDir, "mcp.json"),
    "omp mcp.json already in sync",
    "omp mcp.json synced",
  );
  const configFile = p(agentDir, "config.yml");
  const configBackedUp = syncMergedYaml(ctx, "SoT/.omp/config.yml", configFile, mergeOmpConfig);
  // mergeOmpConfig is additive, so the prune must run on the merged result.
  syncOmpRemovals(ctx, configFile, configBackedUp);
  const modelsFile = p(agentDir, "models.yml");
  const modelsBackedUp = syncMergedYaml(ctx, "SoT/.omp/models.yml", modelsFile, mergeOmpModels);
  syncOmpModelRemovals(ctx, modelsFile, modelsBackedUp);

  if (!ctx.dryRun) ensureDirectory(intercomDir);
  syncWholeFile(
    ctx,
    "SoT/.omp/intercom.json",
    p(intercomDir, "config.json"),
    "omp intercom configuration already in sync",
    "omp intercom configuration synced",
  );
  // The plugin pass links this directory, so the files must exist first.
  syncKitPlugin(ctx);

  await syncMarketplace(ctx, paths);
  const pluginsInstalled = await syncPlugins(ctx, paths);

  // omp adopts `$XDG_DATA_HOME/omp` once it exists. When another sync created
  // it during this run, a later omp process uses that root and does not see
  // the plugins of the locked root. The next sync locks and fills the new root.
  if (!ctx.dryRun) {
    const currentRoot = ompPaths({
      home: ctx.home,
      env: process.env,
      platform: ctx.services.platform.raw(),
    }).dataRoot;
    if (currentRoot !== paths.dataRoot) {
      recordFailure(
        ctx,
        `omp data root moved to ${currentRoot} during the sync; run docks-kit sync again`,
      );
    }
  }
  return { pluginsInstalled, agentDir };
}

// -------------------------------------------------------------- summary ----

export function ompSummary(ctx: Ctx, state: OmpState): void {
  const { echo } = ctx.services.logger;
  echo(`omp:      ${state.agentDir}`);
  if (!ctx.dryRun) echo(`omp plugins: ${state.pluginsInstalled} installed`);
}

/**
 * The omp next steps. The upgrade rule and the restart advice are independent,
 * because a sync can upgrade a plugin and also change a file that needs a restart.
 */
export function ompNextSteps(ctx: Ctx): Array<string> {
  const steps: Array<string> = [];
  if (ctx.nextStepTriggers.ompPluginUpgraded) {
    steps.push(
      "Run /reload-plugins in each running omp session, then read each plugin skill again through skill://. Restart omp instead when an upgraded plugin ships hooks, extension modules, or non-MCP tools.",
    );
  }
  if (ctx.verbose || ctx.nextStepTriggers.ompRestart) {
    steps.push("Restart omp to load any refreshed plugins, skills, or tools.");
  }
  return steps;
}
