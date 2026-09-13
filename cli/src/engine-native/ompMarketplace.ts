/**
 * EngineNative omp marketplace pass: registry detection plus register, adopt,
 * and refresh flows. Split from ompSync.ts; the orchestration still lives
 * there. `firstOutputLine` is shared with the plugin pass in ompPlugins.ts.
 */
import { existsSync, readFileSync } from "node:fs";

import { spawnProcess, type AsyncProcessResult } from "./exec";
import { recordFailure } from "./failures";
import type { Ctx } from "./index";
import { isObject, parseJson } from "./jq";

const MARKETPLACE_NAME = "docks";
const MARKETPLACE_SOURCE = "https://github.com/DocksDocks/docks.git";

// ---------------------------------------------------------- marketplace ----

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
  if (isObject(registry) && Object.hasOwn(registry, MARKETPLACE_NAME)) return true;

  const entries = Array.isArray(registry)
    ? registry
    : isObject(registry) && Array.isArray(registry["marketplaces"])
      ? registry["marketplaces"]
      : [];
  return entries.some((entry) => isObject(entry) && entry["name"] === MARKETPLACE_NAME);
}

export function firstOutputLine(result: AsyncProcessResult): string {
  const output = `${result.stdout}${result.stderr}`;
  return output.split("\n")[0] || "unknown error";
}

/**
 * Three states, because upstream `getMarketplacesRegistryPath` copies a legacy
 * `configRoot` registry forward the first time it resolves an XDG data root:
 * the active registry lists docks, only the legacy registry lists it, or
 * neither does. In the middle state the kit never copies user data itself; it
 * takes the refresh path, whose own resolution inside omp performs that
 * adoption and leaves the active registry present.
 */
export async function syncMarketplace(
  ctx: Ctx,
  registryFile: string,
  legacyRegistryFile?: string,
): Promise<void> {
  const { change, clearProgress, echo, progress, verbose } = ctx.services.logger;
  const registered = registryHasDocks(registryFile);
  const adoptable =
    !registered && legacyRegistryFile !== undefined && registryHasDocks(legacyRegistryFile);

  if (ctx.dryRun) {
    if (adoptable) {
      echo(
        ctx.skipPluginRefresh === true
          ? "[dry-run] omp plugin marketplace list"
          : `[dry-run] omp plugin marketplace update ${MARKETPLACE_NAME}`,
      );
    } else if (registered) verbose("omp docks marketplace already registered");
    else echo(`[dry-run] omp plugin marketplace add ${MARKETPLACE_SOURCE}`);
    return;
  }

  // syncPlugins owns the single skip message for both missing CLIs, and it runs
  // right after this pass. Without omp no marketplace command can run at all,
  // and without git a marketplace clone cannot resolve, so both are deliberate
  // skips: return silently instead of spawning and recording a failure.
  if (ctx.services.deps.probe("omp").state === "missing") return;
  if (ctx.services.deps.probe("git").state === "missing") return;

  if (!registered && !adoptable) {
    progress("Registering omp docks marketplace...");
    const result = await spawnProcess("omp", ["plugin", "marketplace", "add", MARKETPLACE_SOURCE], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    clearProgress();
    if (result.error === undefined && result.exitCode === 0) {
      change("omp docks marketplace registered");
    } else {
      recordFailure(
        ctx,
        `omp docks marketplace registration failed: ${firstOutputLine(result)}; run manually: omp plugin marketplace add ${MARKETPLACE_SOURCE}`,
      );
    }
    return;
  }

  if (ctx.skipPluginRefresh === true) {
    if (!adoptable) {
      verbose("omp docks marketplace already registered; refresh-only update skipped");
      return;
    }

    // Adoption only needs omp to resolve the registry path. `marketplace list`
    // does that and fetches nothing, so it stays inside the flag's contract
    // while leaving the active registry present.
    progress("Adopting omp docks marketplace registry...");
    const listed = await spawnProcess("omp", ["plugin", "marketplace", "list"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    clearProgress();
    if (listed.error === undefined && listed.exitCode === 0) {
      change("omp docks marketplace registry adopted; refresh-only update skipped");
    } else {
      recordFailure(
        ctx,
        `omp docks marketplace adoption failed: ${firstOutputLine(listed)}; run manually: omp plugin marketplace list`,
      );
    }
    return;
  }

  progress("Updating omp docks marketplace...");
  const result = await spawnProcess("omp", ["plugin", "marketplace", "update", MARKETPLACE_NAME], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  clearProgress();
  if (result.error === undefined && result.exitCode === 0) {
    verbose("omp docks marketplace refreshed");
  } else {
    recordFailure(
      ctx,
      `omp docks marketplace update failed: ${firstOutputLine(result)}; run manually: omp plugin marketplace update ${MARKETPLACE_NAME}`,
    );
  }
}
