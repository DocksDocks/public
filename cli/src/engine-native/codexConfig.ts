/**
 * EngineNative Codex config merge and validation. Line-based TOML passes
 * intentionally avoid a TOML library because reformatting user configs would
 * be a behavior change. Guard order, message strings, and backup behavior
 * are golden-tested.
 */
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { payloadDisplayPath } from "../payload";
import { replaceFile } from "./atomicWrite";
import {
  isTomlHeaderLine,
  mergeTableSettings,
  mergeTopLevelSettings,
  tomlContinuationLines,
} from "./codexToml";
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
  // Normalize once before record transforms: a BOM hides the first key or
  // header, and CR bytes change table-header identity.
  writeFileSync(staging, before.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"));

  scrubDeprecatedFeatures(ctx, staging);
  removeRetiredPluginTables(ctx, staging);
  removeRetiredTopLevelSettings(ctx, staging);
  mergeTopLevelSettings(sotConfigText, staging);
  mergeTableSettings(sotConfigText, staging);

  const merged = readFileSync(staging, "utf8");
  rmSync(staging, { force: true });
  if (merged === before) {
    verbose("Codex config already in sync");
  } else {
    copyFileSync(userConfig, `${userConfig}.bak`);
    replaceFile(userConfig, merged);
    change(
      "Codex config merged (backup at config.toml.bak; SoT tables replaced wholesale; user-only top-level keys and tables preserved)",
    );
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
      if (isTomlHeaderLine(line)) {
        inFeatures = false;
        if (keep) out += `${header}\n${body}`;
        else changed = true;
        out += `${line}\n`;
        continue;
      }
      if (/^[ \t]*use_legacy_landlock[ \t]*=/.test(line)) {
        changed = true;
        continue;
      }
      body += `${line}\n`;
      if (/[^ \t\f\v\r]/.test(line)) keep = true;
      continue;
    }
    if (/^[ \t]*\[features\][ \t]*$/.test(line)) {
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

  replaceFile(userConfig, next);
  change("Codex: scrubbed deprecated [features].use_legacy_landlock");
}

export const PLUGIN_TABLE_HEADER = /^[ \t]*\[plugins\."([^"]+)"\][ \t]*$/;
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
      if (!isTomlHeaderLine(line)) continue;
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

  replaceFile(userConfig, removeRetiredPluginTablesText(content));
  for (const id of present) change(`Codex: removed retired plugin table [plugins."${id}"]`);
}

/**
 * Top-level settings the kit retired. Each sync removes a deployed top-level
 * line that holds exactly the retired kit value. A different user value stays.
 */
const RETIRED_TOP_LEVEL_SETTINGS: ReadonlyArray<{
  readonly setting: string;
  readonly pattern: RegExp;
}> = [
  // Codex 0.159.0 deprecated `personality`; "pragmatic" no longer selects a style.
  {
    setting: 'personality = "pragmatic"',
    pattern: /^[ \t]*personality[ \t]*=[ \t]*"pragmatic"[ \t]*$/,
  },
];

/** Drop top-level lines that hold a retired kit setting; returns the text and the removed settings. */
function removeRetiredTopLevelSettingsText(content: string): {
  readonly text: string;
  readonly removed: ReadonlyArray<string>;
} {
  const lines = content.split("\n");
  const continuation = tomlContinuationLines(lines);
  const removed: Array<string> = [];
  const kept: Array<string> = [];
  let inTable = false;
  for (const [index, line] of lines.entries()) {
    if (continuation[index] !== true && !inTable) {
      if (isTomlHeaderLine(line)) {
        inTable = true;
      } else {
        const retired = RETIRED_TOP_LEVEL_SETTINGS.find(({ pattern }) => pattern.test(line));
        if (retired !== undefined) {
          removed.push(retired.setting);
          continue;
        }
      }
    }
    kept.push(line);
  }
  return { text: removed.length === 0 ? content : kept.join("\n"), removed };
}

function removeRetiredTopLevelSettings(ctx: Ctx, userConfig: string): void {
  const { change } = ctx.services.logger;
  const { text, removed } = removeRetiredTopLevelSettingsText(readFileSync(userConfig, "utf8"));
  if (removed.length === 0) return;

  replaceFile(userConfig, text);
  for (const setting of removed) change(`Codex: removed retired top-level setting ${setting}`);
}
