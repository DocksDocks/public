/**
 * EngineNative Codex config merge and validation. Line-based TOML passes
 * intentionally avoid a TOML library because reformatting user configs would
 * be a behavior change. Guard order, message strings, and backup behavior
 * are golden-tested.
 */
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

import { payloadDisplayPath } from "../payload";
import { mergeTableSettings, mergeTopLevelSettings } from "./codexToml";
import type { Ctx } from "./index";

// --------------------------------------------------------------- config ----

export function syncConfig(ctx: Ctx, sotConfigText: string, userConfig: string): void {
  const { change, echo, verbose } = ctx.services.logger;
  const sotConfig = payloadDisplayPath("SoT/.codex/config.toml");

  if (ctx.dryRun) {
    if (existsSync(userConfig)) {
      echo(`[dry-run] merge ${sotConfig} -> ${userConfig}`);
    } else {
      echo(`[dry-run] install ${sotConfig} -> ${userConfig}`);
    }
    return;
  }

  if (!existsSync(userConfig)) {
    writeFileSync(userConfig, sotConfigText);
    change("Codex config installed");
    ctx.nextStepTriggers.codexRestart = true;
    return;
  }

  // Merge into a staging copy so `.bak` is written only when the config
  // actually changes — an unconditional early backup lets a later no-op run
  // overwrite the recovery copy with already-merged content.
  const before = readFileSync(userConfig, "utf8");
  const staging = `${userConfig}.merge.tmp`;
  // Normalize once before record transforms because CR bytes change table-header identity.
  writeFileSync(staging, before.replace(/\r\n/g, "\n"));

  scrubDeprecatedFeatures(ctx, staging);
  removeRetiredPluginTables(ctx, staging);
  mergeTopLevelSettings(sotConfigText, staging);
  mergeTableSettings(sotConfigText, staging);

  if (readFileSync(staging, "utf8") === before) {
    rmSync(staging, { force: true });
    verbose("Codex config already in sync");
  } else {
    copyFileSync(userConfig, `${userConfig}.bak`);
    renameSync(staging, userConfig);
    change("Codex config merged (backup at config.toml.bak; user-only keys/tables preserved)");
    ctx.nextStepTriggers.codexRestart = true;
  }
}

/** codex::scrub_deprecated_features — the [features].use_legacy_landlock awk pass. */
function scrubDeprecatedFeaturesText(content: string): string {
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  let out = "";
  let inFeatures = false;
  let header = "";
  let body = "";
  let keep = false;
  let changed = false;
  for (const line of lines) {
    if (inFeatures) {
      if (line.startsWith("[")) {
        inFeatures = false;
        if (keep) out += `${header}\n${body}`;
        else changed = true;
        out += `${line}\n`;
        continue;
      }
      if (/^use_legacy_landlock[ \t]*=/.test(line)) {
        changed = true;
        continue;
      }
      body += `${line}\n`;
      if (/[^ \t\f\v\r]/.test(line)) keep = true;
      continue;
    }
    if (/^\[features\][ \t]*$/.test(line)) {
      inFeatures = true;
      header = line;
      body = "";
      keep = false;
      continue;
    }
    out += `${line}\n`;
  }
  if (inFeatures) {
    if (keep) out += `${header}\n${body}`;
    else changed = true;
  }
  return changed ? out : content;
}

function scrubDeprecatedFeatures(ctx: Ctx, userConfig: string): void {
  const { change } = ctx.services.logger;
  if (!existsSync(userConfig)) return;
  const content = readFileSync(userConfig, "utf8");
  const next = scrubDeprecatedFeaturesText(content);
  if (next === content) return;

  writeFileSync(`${userConfig}.tmp`, next);
  renameSync(`${userConfig}.tmp`, userConfig);
  change("Codex: scrubbed deprecated [features].use_legacy_landlock");
}

export const PLUGIN_TABLE_HEADER = /^\[plugins\."([^"]+)"\][ \t]*$/;
/** Plugin ids the kit retired; their deployed tables are stripped on every sync. */
const RETIRED_PLUGIN_IDS: Readonly<Record<string, true>> = {
  "effect-kit@docks": true,
  "session-relay@docks": true,
};

/** codex::remove_retired_plugin_tables — drop [plugins."<id>"] blocks for retired ids. */
export function removeRetiredPluginTablesText(content: string): string {
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  let out = "";
  let skipping = false;
  for (const line of lines) {
    const header = PLUGIN_TABLE_HEADER.exec(line);
    if (header !== null) {
      skipping = RETIRED_PLUGIN_IDS[header[1]!] === true;
      if (skipping) continue;
    } else if (skipping) {
      if (!line.startsWith("[")) continue;
      skipping = false;
    }
    out += `${line}\n`;
  }
  return out;
}

function retiredPluginTables(content: string): Array<string> {
  return content
    .split("\n")
    .map((line) => PLUGIN_TABLE_HEADER.exec(line)?.[1])
    .filter((id): id is string => id !== undefined && RETIRED_PLUGIN_IDS[id] === true);
}

export function removeRetiredPluginTables(ctx: Ctx, userConfig: string): void {
  const { change } = ctx.services.logger;
  if (!existsSync(userConfig)) return;
  const content = readFileSync(userConfig, "utf8");
  const present = retiredPluginTables(content);
  if (present.length === 0) return;

  writeFileSync(`${userConfig}.tmp`, removeRetiredPluginTablesText(content));
  renameSync(`${userConfig}.tmp`, userConfig);
  for (const id of present) change(`Codex: removed retired plugin table [plugins."${id}"]`);
}
