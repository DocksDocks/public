/**
 * EngineNative Codex marketplace and plugin passes: personal marketplace
 * merge, legacy marketplace removal, and enabled-plugin refresh. Message
 * strings and backup behavior are golden-tested.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { payloadDisplayPath } from "../payload";
import { replaceFile } from "./atomicWrite";
import { PLUGIN_TABLE_HEADER } from "./codexConfig";
import { isTomlHeaderLine } from "./codexToml";
import { p, processFailureSummary, spawnProcess } from "./exec";
import { recordFailure } from "./failures";
import type { Ctx } from "./index";
import { compareCodepoints, isObject, jqStringify, parseJson, type Json } from "./jq";
import type { JsonObject } from "./sharedTypes";

// ---------------------------------------------------------- marketplace ----

/**
 * Merge the SoT marketplace into the deployed personal marketplace. Codex
 * resolves a plugin id `<plugin>@<marketplace>` through the file's top-level
 * `name`. When the deployed file has a different name, the file stays as it is
 * and the SoT marketplace name comes back, because kit plugin ids cannot resolve.
 */
export function syncMarketplace(
  ctx: Ctx,
  sotMarketplaceText: string,
  userMarketplace: string,
): string | undefined {
  const { change, echo, verbose, warn } = ctx.services.logger;
  const sotMarketplace = payloadDisplayPath("SoT/.codex/plugins/marketplace.json");
  const repo = parseJson(sotMarketplaceText);
  if (repo === undefined) throw new Error(`invalid SoT marketplace JSON: ${sotMarketplace}`);

  const userText = existsSync(userMarketplace) ? readFileSync(userMarketplace, "utf8") : undefined;
  const user = userText === undefined ? undefined : parseJson(userText);
  if (userText !== undefined && user === undefined) {
    throw new Error(
      `invalid deployed Codex marketplace JSON: ${userMarketplace}. Fix or delete it.`,
    );
  }

  const sotName = isObject(repo) && typeof repo["name"] === "string" ? repo["name"] : undefined;
  const userName =
    user !== undefined && isObject(user) && typeof user["name"] === "string"
      ? user["name"]
      : undefined;
  if (sotName !== undefined && userName !== undefined && userName !== sotName) {
    warn(
      `Codex personal marketplace ${userMarketplace} is named "${userName}", but kit plugins need "${sotName}". Rename it to "${sotName}" and update your [plugins."<plugin>@${userName}"] tables, or move your plugins to a different marketplace. Then run sync again.`,
    );
    return sotName;
  }
  const out = user === undefined ? undefined : jqStringify(mergeMarketplace(repo, user));

  if (ctx.dryRun) {
    if (userText === undefined) {
      echo(`[dry-run] cp ${sotMarketplace} -> ${userMarketplace}`);
    } else if (out === userText) {
      verbose("Codex marketplace already in sync");
    } else {
      echo(
        `[dry-run] merge ${sotMarketplace} -> ${userMarketplace} (backup at ${userMarketplace}.bak)`,
      );
    }
    return undefined;
  }

  mkdirSync(p(ctx.agentsDir, "plugins"), { recursive: true });
  if (userText !== undefined && out !== undefined) {
    if (out === userText) {
      verbose("Codex marketplace already in sync");
      return undefined;
    }
    copyFileSync(userMarketplace, `${userMarketplace}.bak`);
    replaceFile(userMarketplace, out);
    change("Codex marketplace merged (backup at marketplace.json.bak)");
    ctx.nextStepTriggers.codexRestart = true;
  } else {
    // Install the merge form, so the next sync merges to the same bytes.
    writeFileSync(userMarketplace, jqStringify(mergeMarketplace(repo, {})));
    change("Codex marketplace installed");
    ctx.nextStepTriggers.codexRestart = true;
  }
  return undefined;
}

/**
 * The jq -s marketplace merge: `$user *` a {name, interface} coalesce, then
 * plugins = user+repo | reverse | unique_by(.name) | reverse — SoT (repo)
 * wins per plugin name; distinct names end up descending by name, exactly
 * like jq's unique_by (ascending) followed by reverse.
 */
function mergeMarketplace(repo: Json, user: Json): Json {
  const u = isObject(user) ? user : {};
  const r = isObject(repo) ? repo : {};
  const coalesce = (a: Json | undefined, b: Json | undefined): Json =>
    a !== undefined && a !== null && a !== false ? a : (b ?? null);
  const merged: JsonObject = {
    ...u,
    name: coalesce(u["name"], r["name"]),
    interface: coalesce(u["interface"], r["interface"]),
  };
  const plugins = [
    ...(Array.isArray(u["plugins"]) ? u["plugins"] : []),
    ...(Array.isArray(r["plugins"]) ? r["plugins"] : []),
  ];
  const firstByName = new Map<string, Json>();
  for (const entry of [...plugins].reverse()) {
    const name = isObject(entry) && typeof entry["name"] === "string" ? entry["name"] : "";
    if (!firstByName.has(name)) firstByName.set(name, entry);
  }
  merged["plugins"] = [...firstByName.keys()]
    .sort(compareCodepoints)
    .map((n) => firstByName.get(n)!)
    .reverse();
  return merged;
}

// -------------------------------------------------------------- plugins ----

/** codex::_marketplace_source — first `source =` inside [marketplaces.<name>]. */
export function marketplaceSource(marketplace: string, configFile: string): string {
  if (!existsSync(configFile)) return "";
  let inMarketplace = false;
  for (const line of readFileSync(configFile, "utf8").split("\n")) {
    if (line.trim() === `[marketplaces.${marketplace}]`) {
      inMarketplace = true;
      continue;
    }
    if (isTomlHeaderLine(line)) inMarketplace = false;
    if (inMarketplace && /^[ \t]*source[ \t]*=/.test(line)) {
      return line
        .replace(/^[^=]+=[ \t]*/, "")
        .replace(/[ \t]*#.*/, "")
        .replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  return "";
}

export async function removeLegacyDocksMarketplace(ctx: Ctx, userConfig: string): Promise<void> {
  const { change, echo } = ctx.services.logger;
  if (ctx.dryRun) {
    echo(
      "[dry-run] remove legacy configured Codex Docks marketplace when personal marketplace is deployed",
    );
    return;
  }

  if (ctx.services.deps.probe("codex").state === "missing") return;

  const source = marketplaceSource("docks", userConfig);
  if (source !== "https://github.com/DocksDocks/docks.git" && source !== "DocksDocks/docks") return;
  const res = await spawnProcess("codex", ["plugin", "marketplace", "remove", "docks"], {
    stdio: "ignore",
  });
  if (res.error === undefined && res.exitCode === 0) {
    change("Removed legacy configured Codex Docks marketplace; using personal marketplace file");
    ctx.nextStepTriggers.codexRestart = true;
  } else {
    recordFailure(ctx, "Failed to remove legacy configured Codex Docks marketplace");
  }
}

/** codex::_standalone_install_command — per-OS official standalone installer. */
const standaloneInstallCommand = (ctx: Ctx): string =>
  ctx.services.deps.spec("codex").installHint();

/** codex::_enabled_plugin_ids — [plugins."<id>"] tables with enabled = true. */
export function enabledPluginIds(configFile: string): Array<string> {
  if (!existsSync(configFile)) return [];
  return enabledPluginIdsFromText(readFileSync(configFile, "utf8"));
}

function enabledPluginIdsFromText(configText: string): Array<string> {
  const ids: Array<string> = [];
  let plugin = "";
  let enabled = false;
  const flush = (): void => {
    if (plugin !== "" && enabled) ids.push(plugin);
  };
  for (const line of configText.split("\n")) {
    const m = PLUGIN_TABLE_HEADER.exec(line);
    if (m !== null) {
      flush();
      plugin = m[1]!;
      enabled = false;
      continue;
    }
    if (isTomlHeaderLine(line)) {
      flush();
      plugin = "";
      enabled = false;
      continue;
    }
    if (plugin !== "" && /^[ \t]*enabled[ \t]*=[ \t]*true([ \t]*(#.*)?)?$/.test(line)) {
      enabled = true;
    }
  }
  flush();
  return ids;
}

function manualPluginRefreshHint(pluginIds: ReadonlyArray<string>): string {
  const first = pluginIds[0];
  return first !== undefined ? `; then run: codex plugin add ${first}` : "";
}

async function installedPluginIdsFromCli(): Promise<Set<string> | undefined> {
  const result = await spawnProcess("codex", ["plugin", "list", "--json"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error !== undefined || result.exitCode !== 0) return undefined;
  const value = parseJson(result.stdout);
  if (value === undefined || !isObject(value) || !Array.isArray(value["installed"]))
    return undefined;
  const ids = new Set<string>();
  for (const row of value["installed"]) {
    if (!isObject(row) || row["installed"] !== true || typeof row["pluginId"] !== "string")
      continue;
    ids.add(row["pluginId"]);
  }
  return ids;
}

/**
 * Add the SoT-enabled plugins through the Codex CLI. `unresolvedMarketplace`
 * names a marketplace that syncMarketplace could not deploy; ids from it are
 * skipped, because `codex plugin add` cannot resolve them.
 */
export async function syncPlugins(
  ctx: Ctx,
  sotConfigText: string,
  unresolvedMarketplace?: string,
): Promise<void> {
  const { change, clearProgress, echo, progress, verbose, warn } = ctx.services.logger;
  const desiredPluginIds = enabledPluginIdsFromText(sotConfigText).filter(
    (pluginId) =>
      unresolvedMarketplace === undefined || !pluginId.endsWith(`@${unresolvedMarketplace}`),
  );
  if (ctx.dryRun) {
    if (desiredPluginIds.length === 0) return;
    echo(
      ctx.skipPluginRefresh
        ? "[dry-run] add missing enabled Codex plugins from SoT; skip refresh-only plugin updates"
        : "[dry-run] add enabled Codex plugins from SoT",
    );
    return;
  }

  if (ctx.services.deps.probe("codex").state === "missing") {
    warn(
      `codex CLI not in PATH - deployed config/marketplace only; install Codex with: ${standaloneInstallCommand(ctx)} | docs: https://developers.openai.com/codex/cli${manualPluginRefreshHint(desiredPluginIds)}`,
    );
    return;
  }
  if (desiredPluginIds.length === 0) return;
  if (ctx.services.deps.probe("git").state === "missing") {
    ctx.services.deps.warnMissing(
      "git",
      ctx.services.logger,
      "plugin marketplaces are git repos — Codex plugin refresh skipped; re-run sync after installing",
    );
    return;
  }

  let pluginIds = desiredPluginIds;
  if (ctx.skipPluginRefresh) {
    progress("Checking installed Codex plugins...");
    const installedPluginIds = await installedPluginIdsFromCli();
    clearProgress();
    if (installedPluginIds === undefined) {
      warn("Codex plugin inventory unavailable — falling back to the full refresh path");
    } else {
      pluginIds = desiredPluginIds.filter((pluginId) => !installedPluginIds.has(pluginId));
    }
  }

  let refreshed = 0;
  let failed = 0;
  for (const pluginId of pluginIds) {
    progress(`Updating Codex plugin ${pluginId}...`);
    const res = await spawnProcess("codex", ["plugin", "add", pluginId], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    clearProgress();
    const addOut = `${res.stdout}${res.stderr}`;
    if (res.error === undefined && res.exitCode === 0) {
      refreshed++;
    } else if (addOut.includes("could not find a Codex CLI binary")) {
      recordFailure(
        ctx,
        `Codex plugin refresh hit a stale launcher/wrapper on PATH - install current standalone Codex with: ${standaloneInstallCommand(ctx)}`,
      );
      failed++;
    } else {
      recordFailure(
        ctx,
        `Codex plugin refresh failed for ${pluginId}: ${processFailureSummary(res)}; run manually: codex plugin add ${pluginId}`,
      );
      failed++;
    }
  }

  if (refreshed > 0) {
    change(`Codex plugins synced (plugins: ~${refreshed})`);
    ctx.nextStepTriggers.codexRestart = true;
  }
  if (ctx.skipPluginRefresh && pluginIds.length === 0)
    verbose("Codex plugins already installed; refresh-only updates skipped");
  if (failed > 0)
    warn(`${failed} Codex plugin operation(s) failed — re-run sync or install manually`);
}
