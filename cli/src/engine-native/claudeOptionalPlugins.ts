/**
 * EngineNative `sync claude` optional-plugin opt-in pass (--claude-plugin).
 * Split from claudePluginPasses along the opt-in axis; message strings
 * and spawned argv are part of the golden-tested contract.
 */
import { p } from "./exec";
import { recordFailure } from "./failures";
import type { Ctx } from "./index";
import { isObject, readJsonFile } from "./jq";
import type { JsonObject } from "./sharedTypes";
import { cli, pluginUserScopeInstalled } from "./claudePluginPasses";

async function enableOptionalPlugin(
  ctx: Ctx,
  claudeDir: string,
  pluginId: string,
  marketplaceRepo: string,
): Promise<boolean> {
  const { change, clearProgress, progress, verbose } = ctx.services.logger;
  const installedPlugins = p(claudeDir, "plugins", "installed_plugins.json");
  const knownMarketplaces = p(claudeDir, "plugins", "known_marketplaces.json");
  const mpName = pluginId.slice(pluginId.lastIndexOf("@") + 1);

  let marketplaceAdded = false;
  if (marketplaceRepo !== "") {
    const known = readJsonFile(knownMarketplaces);
    const has =
      known !== undefined &&
      isObject(known) &&
      known[mpName] !== undefined &&
      known[mpName] !== null &&
      known[mpName] !== false;
    if (!has) {
      if (!(await cli(["plugin", "marketplace", "add", marketplaceRepo])).ok) {
        recordFailure(ctx, `Failed to add marketplace ${marketplaceRepo} for ${pluginId}`);
        return false;
      }
      marketplaceAdded = true;
    }
  }

  const wasInstalled = pluginUserScopeInstalled(installedPlugins, pluginId);
  if (!wasInstalled) {
    progress(`Installing plugin ${pluginId}...`);
    const installResult = await cli(["plugin", "install", pluginId]);
    clearProgress();
    if (!installResult.ok) {
      if (marketplaceAdded)
        change(
          `Optional plugin ${pluginId}: marketplace added (install failed — will retry next sync)`,
        );
      recordFailure(ctx, `Failed to install optional plugin ${pluginId}`);
      return marketplaceAdded;
    }
  }

  const settingsDoc = readJsonFile(p(claudeDir, "settings.json"));
  const wasEnabled =
    settingsDoc !== undefined && isObject(settingsDoc) && isObject(settingsDoc["enabledPlugins"])
      ? (settingsDoc["enabledPlugins"] as JsonObject)[pluginId] === true
      : false;

  if (!(await cli(["plugin", "enable", pluginId])).ok) {
    if (marketplaceAdded || !wasInstalled)
      change(`Optional plugin ${pluginId}: installed (enable failed — will retry next sync)`);
    recordFailure(ctx, `Failed to enable optional plugin ${pluginId}`);
    return marketplaceAdded || !wasInstalled;
  }
  const changed = marketplaceAdded || !wasInstalled || !wasEnabled;
  if (changed) change(`Optional plugin opted in: ${pluginId}`);
  else verbose(`Optional plugin already opted in: ${pluginId} (enable re-asserted)`);
  return changed;
}

export async function syncOptionalPlugins(ctx: Ctx, claudeDir: string): Promise<void> {
  const { echo, warn } = ctx.services.logger;
  if (ctx.claudePlugins.length === 0) return;

  if (ctx.dryRun) {
    if (ctx.claudePlugins.includes("supabase")) {
      echo(
        "[dry-run] (--claude-plugin=supabase) install + enable supabase@claude-plugins-official in deployed settings",
      );
    }
    if (ctx.claudePlugins.includes("n8n")) {
      echo(
        "[dry-run] (--claude-plugin=n8n) add czlonkowski/n8n-skills marketplace + install + enable n8n-mcp-skills@n8n-mcp-skills",
      );
    }
    return;
  }

  if (ctx.services.deps.probe("claude").state === "missing") {
    warn("claude CLI not in PATH — cannot opt in optional plugins (--claude-plugin)");
    return;
  }

  if (ctx.claudePlugins.includes("supabase")) {
    if (await enableOptionalPlugin(ctx, claudeDir, "supabase@claude-plugins-official", ""))
      ctx.nextStepTriggers.claudePlugins = true;
  }
  if (ctx.claudePlugins.includes("n8n")) {
    if (
      await enableOptionalPlugin(
        ctx,
        claudeDir,
        "n8n-mcp-skills@n8n-mcp-skills",
        "czlonkowski/n8n-skills",
      )
    )
      ctx.nextStepTriggers.claudePlugins = true;
  }
}
