/**
 * EngineNative omp plugin pass: marketplace-plugin install/upgrade, the
 * pinned pi-intercom npm plugin, and the link of the kit plugin that
 * `ompKitPlugin.ts syncKitPlugin` writes. Split from ompSync.ts; the
 * orchestration still lives there.
 */
import { realpathSync } from "node:fs";

import { processFailureSummary, spawnProcess } from "./exec";
import { recordFailure } from "./failures";
import type { Ctx } from "./index";
import { isObject, parseJson } from "./jq";
import { KIT_PLUGIN_NAME, kitPluginDir } from "./ompKitPlugin";
import { field } from "./toolchain";

const MARKETPLACE_PLUGIN_IDS = ["docks@docks", "plan-lifecycle@docks"] as const;

// -------------------------------------------------------------- plugins ----

interface InstalledNpmPlugin {
  readonly version: string;
  /** The `node_modules` entry of the plugin, a symbolic link for a linked plugin. */
  readonly path: string | undefined;
}

interface InstalledPlugins {
  /** Each user-scope marketplace plugin id, with its version when the row reports one. */
  readonly marketplace: Map<string, string | undefined>;
  readonly npm: Map<string, InstalledNpmPlugin>;
}

/** One successful plugin operation, named in the sync summary line. */
type PluginOperation =
  | {
      readonly kind: "marketplace" | "npm";
      readonly id: string;
      /**
       * Whether the inventory listed the plugin before the operation, or
       * undefined when that inventory could not be read.
       */
      readonly present: boolean | undefined;
      readonly before: string | undefined;
    }
  | { readonly kind: "link"; readonly id: string };

/** The version of the first entry that reports one; a marketplace row has no top-level version. */
function marketplaceEntryVersion(entries: unknown): string | undefined {
  if (!Array.isArray(entries)) return undefined;
  for (const entry of entries) {
    if (isObject(entry) && typeof entry["version"] === "string") return entry["version"];
  }
  return undefined;
}

async function installedPluginIdsFromCli(): Promise<InstalledPlugins | undefined> {
  const result = await spawnProcess("omp", ["plugin", "list", "--json"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
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
  // `{ id: "<plugin>@<marketplace>", scope, entries: [...] }` - the composite id
  // is already the token `omp plugin install/upgrade` takes. omp emits one row
  // per scope holding the plugin, so a match found only in a `project` row
  // means the user scope is empty and `upgrade --scope user` would fail; only a
  // `user` row counts as installed for this pipeline.
  const marketplace = new Map<string, string | undefined>();
  for (const row of value["marketplace"]) {
    if (!isObject(row) || typeof row["id"] !== "string" || row["scope"] !== "user") continue;
    marketplace.set(row["id"], marketplaceEntryVersion(row["entries"]));
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
 * Names one operation with its version change. `after` is the inventory read
 * after all operations; when it does not give a version, only the id remains.
 */
function describeOperation(
  operation: PluginOperation,
  after: InstalledPlugins | undefined,
): string {
  if (operation.kind === "link") return `${operation.id} linked`;
  const version =
    operation.kind === "marketplace"
      ? after?.marketplace.get(operation.id)
      : after?.npm.get(operation.id)?.version;
  if (version === undefined) return operation.id;
  if (operation.present === false) return `${operation.id} ${version} (new)`;
  if (operation.before === undefined) return `${operation.id} ${version}`;
  if (operation.before === version) return `${operation.id} ${version} (current)`;
  return `${operation.id} ${operation.before} -> ${version}`;
}

async function runPluginCommand(
  ctx: Ctx,
  plugin: string,
  args: ReadonlyArray<string>,
): Promise<boolean> {
  const { clearProgress, progress } = ctx.services.logger;
  progress(`Updating omp plugin ${plugin}...`);
  const result = await spawnProcess("omp", args, { stdio: ["ignore", "pipe", "pipe"] });
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

export async function syncPlugins(ctx: Ctx): Promise<number> {
  const { change, clearProgress, echo, progress, verbose, warn } = ctx.services.logger;

  if (ctx.services.deps.probe("omp").state === "missing") {
    ctx.services.deps.warnMissing(
      "omp",
      ctx.services.logger,
      "deployed omp config only — marketplace and plugin passes skipped; re-run sync after installing",
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

  if (ctx.dryRun) {
    const piIntercomPin = field("pi-intercom", "verified");
    for (const pluginId of MARKETPLACE_PLUGIN_IDS) {
      echo(`[dry-run] omp plugin install --scope user ${pluginId}`);
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

  const piIntercomPin = field("pi-intercom", "verified");

  progress("Checking installed omp plugins...");
  const installed = await installedPluginIdsFromCli();
  clearProgress();
  if (installed === undefined) {
    warn("omp plugin inventory unavailable — falling back to the full refresh path");
  }

  let pluginsInstalled =
    installed === undefined
      ? 0
      : MARKETPLACE_PLUGIN_IDS.filter((pluginId) => installed.marketplace.has(pluginId)).length +
        (piIntercomPin !== "" && installed.npm.has("pi-intercom") ? 1 : 0) +
        (installed.npm.has(KIT_PLUGIN_NAME) ? 1 : 0);
  const operations: Array<PluginOperation> = [];

  for (const pluginId of MARKETPLACE_PLUGIN_IDS) {
    const present = installed?.marketplace.has(pluginId) === true;
    if (present && ctx.skipPluginRefresh === true) {
      verbose(`omp plugin ${pluginId} already installed; refresh-only update skipped`);
      continue;
    }

    const args = present
      ? ["plugin", "upgrade", "--scope", "user", pluginId]
      : ["plugin", "install", "--scope", "user", pluginId];
    if (await runPluginCommand(ctx, pluginId, args)) {
      operations.push({
        kind: "marketplace",
        id: pluginId,
        present: installed === undefined ? undefined : present,
        before: installed?.marketplace.get(pluginId),
      });
      if (!present) pluginsInstalled++;
    }
  }

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
      if (await runPluginCommand(ctx, "pi-intercom", args)) {
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
  } else if (await runPluginCommand(ctx, KIT_PLUGIN_NAME, ["plugin", "link", kitDir])) {
    operations.push({ kind: "link", id: KIT_PLUGIN_NAME });
    if (installed?.npm.has(KIT_PLUGIN_NAME) !== true) pluginsInstalled++;
  }

  if (operations.length > 0) {
    // A second inventory read gives the versions that the operations left.
    progress("Reading omp plugin versions...");
    const after = await installedPluginIdsFromCli();
    clearProgress();
    const items = operations.map((operation) => describeOperation(operation, after));
    change(`omp plugins synced: ${items.join(", ")}`);
    ctx.nextStepTriggers.ompRestart = true;
  } else {
    verbose("omp plugins already in sync");
  }
  return pluginsInstalled;
}
