/**
 * EngineNative `sync omp` pipeline. config.yml merges through mergeOmpConfig
 * and models.yml through mergeOmpModels. Both preserve user-only keys. The
 * agent `.env` merges by key through mergeDotenv, so user keys stay.
 * Paths come from ompPaths because profiles, PI_CONFIG_DIR,
 * PI_CODING_AGENT_DIR, and XDG roots each move them.
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
import type { Ctx } from "./index";
import { ompPaths } from "./ompPaths";
import { mergeOmpConfig, mergeOmpModels } from "./ompYaml";
import { ensureDirectory, syncMergedDotenv, syncMergedYaml, syncWholeFile } from "./ompFileDeploy";
import { syncKitPlugin } from "./ompKitPlugin";
import { syncMarketplace } from "./ompMarketplace";
import { syncPlugins } from "./ompPlugins";
import { syncOmpModelRemovals, syncOmpRemovals } from "./ompRemovals";

export interface OmpState {
  readonly pluginsInstalled: number;
}

export async function ompSync(ctx: Ctx): Promise<OmpState> {
  await bunBootstrap(ctx, ctx.services);

  const paths = ompPaths({
    home: ctx.home,
    env: process.env,
    platform: ctx.services.platform.raw(),
  });
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
  syncMergedYaml(ctx, "SoT/.omp/config.yml", p(agentDir, "config.yml"), mergeOmpConfig);
  // mergeOmpConfig is additive, so the prune must run on the merged result.
  syncOmpRemovals(ctx, p(agentDir, "config.yml"));
  syncMergedYaml(ctx, "SoT/.omp/models.yml", p(agentDir, "models.yml"), mergeOmpModels);
  syncOmpModelRemovals(ctx, p(agentDir, "models.yml"));
  // omp loads <agentDir>/.env into its environment for each key the process
  // environment does not set. The kit key turns off the in-process bash
  // builtins, which can drop the agent.db locks (can1357/oh-my-pi#15586).
  syncMergedDotenv(ctx, "SoT/.omp/agent.env", p(agentDir, ".env"));

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
  const intercomDir = p(intercomRoot, "intercom");
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

  const legacyRegistryFile =
    paths.dataRoot === paths.configRoot ? undefined : p(paths.configRoot, "marketplaces.json");
  await syncMarketplace(ctx, p(paths.dataRoot, "marketplaces.json"), legacyRegistryFile);
  const pluginsInstalled = await syncPlugins(ctx);
  return { pluginsInstalled };
}

// -------------------------------------------------------------- summary ----

export function ompSummary(ctx: Ctx, state: OmpState): void {
  const { echo } = ctx.services.logger;
  const agentDir = ompPaths({
    home: ctx.home,
    env: process.env,
    platform: ctx.services.platform.raw(),
  }).agentDir;
  echo(`omp:      ${agentDir}`);
  if (!ctx.dryRun) echo(`omp plugins: ${state.pluginsInstalled} installed`);
}

export function ompNextSteps(ctx: Ctx): Array<string> {
  return ctx.verbose || ctx.nextStepTriggers.ompRestart
    ? ["Restart omp to load any refreshed plugins, skills, or tools."]
    : [];
}
