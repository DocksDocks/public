/**
 * EngineNative omp plugin pass: the retirement of the docks marketplace
 * plugins, the pinned pi-intercom npm plugin, and the link of the kit plugin
 * that `ompKitPlugin.ts syncKitPlugin` writes. Split from ompSync.ts; the
 * orchestration still lives there.
 *
 * The kit plugin now ships the content of the retired `docks@docks` and
 * `plan-lifecycle@docks` marketplace plugins. Each real sync uninstalls their
 * user-scope installs, warns about their project-scope installs, and then
 * removes the `docks` marketplace. A second sync after a successful
 * retirement runs no omp mutation for it.
 */
import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";

import { p, processFailureSummary } from "./exec";
import { recordFailure } from "./failures";
import type { Ctx } from "./index";
import { isObject, parseJson } from "./jq";
import { spawnOmp } from "./ompChild";
import { KIT_PLUGIN_NAME, kitPluginDir } from "./ompKitPlugin";
import type { OmpPaths } from "./ompPaths";
import { kitCacheDir } from "./scratch";
import { field } from "./toolchain";

/** The marketplace plugins whose content the kit plugin now ships. */
const RETIRED_PLUGIN_IDS = ["docks@docks", "plan-lifecycle@docks"] as const;
/** The marketplace of the retired plugins. */
const RETIRED_MARKETPLACE = "docks";
/** The label of the marketplace in progress, failure, and summary texts. */
const RETIRED_MARKETPLACE_LABEL = `${RETIRED_MARKETPLACE} marketplace`;

// -------------------------------------------------------------- plugins ----

interface InstalledNpmPlugin {
  readonly version: string;
  /** The `node_modules` entry of the plugin, a symbolic link for a linked plugin. */
  readonly path: string | undefined;
}

/** The install scopes of omp marketplace plugins. */
type MarketplaceScope = "user" | "project";

interface InstalledMarketplacePlugin {
  /** The composite id `<plugin>@<marketplace>`. */
  readonly id: string;
  readonly scope: MarketplaceScope;
}

interface InstalledPlugins {
  /** One row for each scope that holds a marketplace plugin. */
  readonly marketplace: ReadonlyArray<InstalledMarketplacePlugin>;
  readonly npm: Map<string, InstalledNpmPlugin>;
}

/** One successful plugin operation, named in the sync summary line. */
type PluginOperation =
  | {
      readonly kind: "npm";
      readonly id: string;
      /**
       * Whether the inventory listed the plugin before the operation, or
       * undefined when that inventory could not be read.
       */
      readonly present: boolean | undefined;
      readonly before: string | undefined;
    }
  | { readonly kind: "link"; readonly id: string }
  | { readonly kind: "uninstall"; readonly id: string }
  | { readonly kind: "marketplaceRemove" };

async function installedPluginsFromCli(paths: OmpPaths): Promise<InstalledPlugins | undefined> {
  const result = await spawnOmp(paths, ["plugin", "list", "--json"], ["ignore", "pipe", "ignore"]);
  if (result.error !== undefined || result.exitCode !== 0) return undefined;

  const value = parseJson(result.stdout);
  if (
    value === undefined ||
    !isObject(value) ||
    !Array.isArray(value["marketplace"]) ||
    !Array.isArray(value["npm"])
  ) {
    return undefined;
  }

  // `omp plugin list --json` reports marketplace rows as
  // `{ id: "<plugin>@<marketplace>", scope, entries: [...] }`. The composite
  // id is the token that `omp plugin uninstall` takes. omp emits one row for
  // each scope that holds the plugin.
  const marketplace: Array<InstalledMarketplacePlugin> = [];
  for (const row of value["marketplace"]) {
    if (!isObject(row) || typeof row["id"] !== "string") continue;
    const scope = row["scope"];
    if (scope !== "user" && scope !== "project") continue;
    marketplace.push({ id: row["id"], scope });
  }

  const npm = new Map<string, InstalledNpmPlugin>();
  for (const row of value["npm"]) {
    if (!isObject(row) || typeof row["name"] !== "string" || typeof row["version"] !== "string")
      continue;
    const path = typeof row["path"] === "string" ? row["path"] : undefined;
    npm.set(row["name"], { version: row["version"], path });
  }
  return { marketplace, npm };
}

/**
 * Names one operation. For an npm operation, `after` is the inventory read
 * after all operations; when it does not give a version, only the id remains.
 */
function describeOperation(
  operation: PluginOperation,
  after: InstalledPlugins | undefined,
): string {
  switch (operation.kind) {
    case "link":
      return `${operation.id} linked`;
    case "uninstall":
      return `${operation.id} uninstalled`;
    case "marketplaceRemove":
      return `${RETIRED_MARKETPLACE_LABEL} removed`;
    case "npm": {
      const version = after?.npm.get(operation.id)?.version;
      if (version === undefined) return operation.id;
      if (operation.present === false) return `${operation.id} ${version} (new)`;
      if (operation.before === undefined) return `${operation.id} ${version}`;
      if (operation.before === version) return `${operation.id} ${version} (current)`;
      return `${operation.id} ${operation.before} -> ${version}`;
    }
  }
}

async function runPluginCommand(
  ctx: Ctx,
  paths: OmpPaths,
  plugin: string,
  args: ReadonlyArray<string>,
): Promise<boolean> {
  const { clearProgress, progress } = ctx.services.logger;
  progress(`Updating omp plugin ${plugin}...`);
  const result = await spawnOmp(paths, args, ["ignore", "pipe", "pipe"]);
  clearProgress();
  if (result.error === undefined && result.exitCode === 0) return true;

  recordFailure(
    ctx,
    `omp plugin operation failed for ${plugin}: ${processFailureSummary(result)}; run manually: omp ${args.join(" ")}`,
  );
  return false;
}

function realPath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

// ----------------------------------------------------------- retirement ----

function registryHasDocks(registryFile: string): boolean {
  if (!existsSync(registryFile)) return false;

  let registryText: string;
  try {
    registryText = readFileSync(registryFile, "utf8");
  } catch {
    return false;
  }
  const registry = parseJson(registryText);
  if (registry === undefined) return false;
  if (isObject(registry) && Object.hasOwn(registry, RETIRED_MARKETPLACE)) return true;

  const entries = Array.isArray(registry)
    ? registry
    : isObject(registry) && Array.isArray(registry["marketplaces"])
      ? registry["marketplaces"]
      : [];
  return entries.some((entry) => isObject(entry) && entry["name"] === RETIRED_MARKETPLACE);
}

/**
 * Whether omp knows the `docks` marketplace. omp reads the active registry
 * `<data root>/marketplaces.json`. Upstream `getMarketplacesRegistryPath`
 * copies a legacy `<config root>/marketplaces.json` forward only when it
 * resolves an XDG data root that has no active registry yet. So a legacy
 * entry counts only when no active registry exists; beside an active
 * registry it is stale.
 */
function registryListsDocks(paths: OmpPaths): boolean {
  const activeRegistry = p(paths.dataRoot, "marketplaces.json");
  if (existsSync(activeRegistry)) return registryHasDocks(activeRegistry);
  return (
    paths.dataRoot !== paths.configRoot &&
    registryHasDocks(p(paths.configRoot, "marketplaces.json"))
  );
}

/**
 * Removes the folder of the retired plugin upgrade log, which only the
 * marketplace plugin upgrades wrote. The kit owns the folder.
 */
function removeUpgradeLog(ctx: Ctx): void {
  const dir = p(kitCacheDir(ctx.home), "omp-plugin-upgrades");
  if (!existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
    ctx.services.logger.verbose(`removed the retired omp plugin upgrade log ${dir}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    ctx.services.logger.warn(`retired omp plugin upgrade log not removed: ${detail}`);
  }
}

/**
 * Uninstalls each user-scope install of a retired plugin and warns about each
 * project-scope install, which belongs to that project. Then removes the
 * `docks` marketplace when no uninstall failed and omp knows the marketplace.
 * Returns the successful operations.
 */
async function retireMarketplacePlugins(
  ctx: Ctx,
  paths: OmpPaths,
  installed: InstalledPlugins,
): Promise<Array<PluginOperation>> {
  const { warn } = ctx.services.logger;
  const operations: Array<PluginOperation> = [];
  let uninstallFailed = false;

  for (const pluginId of RETIRED_PLUGIN_IDS) {
    const rows = installed.marketplace.filter((row) => row.id === pluginId);
    if (rows.some((row) => row.scope === "project")) {
      warn(
        `omp plugin ${pluginId} is installed at project scope and docks-kit no longer ships it; run from that project: omp plugin uninstall --scope project ${pluginId}`,
      );
    }
    if (!rows.some((row) => row.scope === "user")) continue;

    const args = ["plugin", "uninstall", "--scope", "user", pluginId];
    if (await runPluginCommand(ctx, paths, pluginId, args)) {
      operations.push({ kind: "uninstall", id: pluginId });
    } else {
      uninstallFailed = true;
    }
  }

  // A failed uninstall keeps the marketplace, so the manual command still resolves the id.
  if (!uninstallFailed && registryListsDocks(paths)) {
    const args = ["plugin", "marketplace", "remove", RETIRED_MARKETPLACE];
    if (await runPluginCommand(ctx, paths, RETIRED_MARKETPLACE_LABEL, args)) {
      operations.push({ kind: "marketplaceRemove" });
    }
  }
  return operations;
}

/** Run the plugin pass. `paths` are the omp paths that the sync locked. */
export async function syncPlugins(ctx: Ctx, paths: OmpPaths): Promise<number> {
  const { change, clearProgress, echo, progress, verbose, warn } = ctx.services.logger;

  if (!ctx.dryRun) removeUpgradeLog(ctx);

  if (ctx.services.deps.probe("omp").state === "missing") {
    ctx.services.deps.warnMissing(
      "omp",
      ctx.services.logger,
      "deployed omp config only — plugin pass skipped; re-run sync after installing",
    );
    return 0;
  }
  if (ctx.services.deps.probe("git").state === "missing") {
    ctx.services.deps.warnMissing(
      "git",
      ctx.services.logger,
      "plugin marketplaces are git repos — omp plugin refresh skipped; re-run sync after installing",
    );
    return 0;
  }

  const piIntercomPin = field("pi-intercom", "verified");

  if (ctx.dryRun) {
    // A dry run reads no inventory, so it previews the uninstall of each retired id.
    for (const pluginId of RETIRED_PLUGIN_IDS) {
      echo(`[dry-run] omp plugin uninstall --scope user ${pluginId}`);
    }
    if (registryListsDocks(paths)) {
      echo(`[dry-run] omp plugin marketplace remove ${RETIRED_MARKETPLACE}`);
    }
    if (piIntercomPin === "") {
      warn(
        "pi-intercom install skipped because SoT/toolchain.json has no verified pi-intercom pin",
      );
    } else {
      echo(`[dry-run] omp install pi-intercom@${piIntercomPin}`);
    }
    echo(`[dry-run] omp plugin link ${kitPluginDir(ctx.home)}`);
    return 0;
  }

  progress("Checking installed omp plugins...");
  const installed = await installedPluginsFromCli(paths);
  clearProgress();

  const operations: Array<PluginOperation> = [];
  if (installed === undefined) {
    warn(
      "omp plugin inventory unavailable — retirement of the docks marketplace plugins skipped until the next sync; pi-intercom and the kit plugin take the full refresh path",
    );
  } else {
    operations.push(...(await retireMarketplacePlugins(ctx, paths, installed)));
  }

  let pluginsInstalled =
    installed === undefined
      ? 0
      : (piIntercomPin !== "" && installed.npm.has("pi-intercom") ? 1 : 0) +
        (installed.npm.has(KIT_PLUGIN_NAME) ? 1 : 0);

  if (piIntercomPin === "") {
    warn("pi-intercom install skipped because SoT/toolchain.json has no verified pi-intercom pin");
  } else {
    const installedVersion = installed?.npm.get("pi-intercom")?.version;
    const present = installedVersion !== undefined;
    if (installedVersion === piIntercomPin) {
      verbose(`omp npm plugin pi-intercom already installed at ${piIntercomPin}`);
    } else if (present && ctx.skipPluginRefresh === true) {
      verbose("omp npm plugin pi-intercom already installed; refresh-only update skipped");
    } else {
      const args = present
        ? ["install", "--force", `pi-intercom@${piIntercomPin}`]
        : ["install", `pi-intercom@${piIntercomPin}`];
      if (await runPluginCommand(ctx, paths, "pi-intercom", args)) {
        operations.push({
          kind: "npm",
          id: "pi-intercom",
          present: installed === undefined ? undefined : present,
          before: installedVersion,
        });
        if (!present) pluginsInstalled++;
      }
    }
  }

  // The kit plugin is linked when omp's entry resolves to the kit directory.
  // A refresh never applies: the link always points at the current files.
  const kitDir = kitPluginDir(ctx.home);
  const kitPluginPath = installed?.npm.get(KIT_PLUGIN_NAME)?.path;
  const linkedTarget = kitPluginPath === undefined ? undefined : realPath(kitPluginPath);
  if (linkedTarget !== undefined && linkedTarget === realPath(kitDir)) {
    verbose(`omp kit plugin ${KIT_PLUGIN_NAME} already linked`);
  } else if (await runPluginCommand(ctx, paths, KIT_PLUGIN_NAME, ["plugin", "link", kitDir])) {
    operations.push({ kind: "link", id: KIT_PLUGIN_NAME });
    if (installed?.npm.has(KIT_PLUGIN_NAME) !== true) pluginsInstalled++;
  }

  if (operations.length === 0) {
    verbose("omp plugins already in sync");
    return pluginsInstalled;
  }

  // Only an npm operation names a version, so only then a second inventory
  // read gives the versions that the operations left.
  let after: InstalledPlugins | undefined;
  if (operations.some((operation) => operation.kind === "npm")) {
    progress("Reading omp plugin versions...");
    after = await installedPluginsFromCli(paths);
    clearProgress();
  }
  const items = operations.map((operation) => describeOperation(operation, after));
  change(`omp plugins synced: ${items.join(", ")}`);
  // An install, a link, or an uninstall changes the plugins that omp loads.
  // A marketplace removal alone changes no loaded plugin.
  if (operations.some((operation) => operation.kind !== "marketplaceRemove")) {
    ctx.nextStepTriggers.ompRestart = true;
  }
  return pluginsInstalled;
}
