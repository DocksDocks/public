/**
 * EngineNative omp kit plugin: writes the embedded `SoT/.omp/plugin/` package
 * into the kit-owned directory `~/.docks-kit/omp-plugin`, which
 * `ompPlugins.ts syncPlugins` links into omp. The kit owns the directory, so
 * a sync replaces changed files without `.bak` copies and removes files that
 * the payload no longer lists. Split from ompSync.ts; the orchestration still
 * lives there.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

import { GENERATED_PACKAGE_VERSION } from "../generated/sotPayload";
import { payloadBytes, payloadDisplayPath, payloadPaths } from "../payload";
import { p } from "./exec";
import type { Ctx } from "./index";
import { ensureDirectory } from "./ompFileDeploy";

export const KIT_PLUGIN_NAME = "docks-kit-omp";

const SOURCE_PREFIX = "SoT/.omp/plugin/";

export function kitPluginDir(home: string): string {
  return p(home, ".docks-kit", "omp-plugin");
}

/** Removes every entry under `directory` that is not a target, then empty directories. */
function pruneStale(directory: string, targets: ReadonlySet<string>): boolean {
  let changed = false;
  for (const name of readdirSync(directory)) {
    const entry = p(directory, name);
    const stat = lstatSync(entry);
    if (stat.isDirectory()) {
      changed = pruneStale(entry, targets) || changed;
      if (readdirSync(entry).length === 0) {
        rmdirSync(entry);
        changed = true;
      }
    } else if (!targets.has(entry)) {
      unlinkSync(entry);
      changed = true;
    }
  }
  return changed;
}

export function syncKitPlugin(ctx: Ctx): void {
  const { change, echo, verbose } = ctx.services.logger;
  const pluginDir = kitPluginDir(ctx.home);
  const files = payloadPaths(SOURCE_PREFIX).map((source) => ({
    source,
    target: p(pluginDir, source.slice(SOURCE_PREFIX.length)),
  }));

  if (ctx.dryRun) {
    for (const { source, target } of files) {
      echo(`[dry-run] cp ${payloadDisplayPath(source)} -> ${target}`);
    }
    return;
  }

  let changed = false;
  for (const { source, target } of files) {
    let content = payloadBytes(source);
    if (source === `${SOURCE_PREFIX}package.json`) {
      // The SoT manifest carries a placeholder version; the kit version replaces it.
      const manifest = JSON.parse(content.toString("utf8")) as Record<string, unknown>;
      manifest["version"] = GENERATED_PACKAGE_VERSION;
      content = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    }
    ensureDirectory(target.slice(0, target.lastIndexOf("/")));
    if (existsSync(target) && readFileSync(target).equals(content)) continue;
    writeFileSync(target, content, { mode: 0o600 });
    chmodSync(target, 0o600);
    changed = true;
  }
  if (existsSync(pluginDir)) {
    changed = pruneStale(pluginDir, new Set(files.map(({ target }) => target))) || changed;
  }

  if (changed) {
    change("omp kit plugin files synced");
    ctx.nextStepTriggers.ompRestart = true;
  } else {
    verbose("omp kit plugin files already in sync");
  }
}
