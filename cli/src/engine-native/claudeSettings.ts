/**
 * EngineNative `sync claude` settings materialization and merge. Step order
 * with the runtime cutover and deploy-time modifiers is load-bearing and
 * golden-tested; message strings and JSON semantics are part of the contract.
 */
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { replaceFile } from "./atomicWrite";
import { p } from "./exec";
import type { Ctx } from "./index";
import { isObject, jqStringify, parseJson, type Json } from "./jq";
import { ExitError } from "./parseArgs";
import { mergeSettings, reconcileSettings } from "./settings";
import { payloadDisplayPath } from "../payload";
import type { JsonObject } from "./sharedTypes";

export interface PreparedClaudeSettings {
  readonly path: string;
  readonly bytes: string;
  readonly previousBytes: string | undefined;
  readonly changed: boolean;
}

function assertMaterializedSettings(bytes: string): void {
  if (bytes.includes("__DOCKS_KIT_"))
    throw new Error("Claude settings contain unresolved runtime sentinels");
}

/**
 * Read the deployed settings document. An unparsable or non-object document
 * aborts the sync, because a merge would replace the user's settings.
 */
function readDeployedSettings(ctx: Ctx, path: string): { text: string; doc: JsonObject } {
  const text = readFileSync(path, "utf8");
  const doc = parseJson(text);
  if (doc === undefined || !isObject(doc)) {
    const reason = doc === undefined ? "is not valid JSON" : "must contain a JSON object";
    ctx.services.logger.err(
      `Aborting sync: ${path} ${reason}. Fix it manually or delete it to reinstall.`,
    );
    throw new ExitError(1);
  }
  return { text, doc };
}

/**
 * Check the deployed settings before any sync pipeline starts. A document
 * that cannot merge stops the whole sync, so no other harness changes first.
 */
export function preflightClaudeSettings(ctx: Ctx): void {
  if (!ctx.syncClaude) return;
  const path = p(ctx.home, ".claude", "settings.json");
  if (existsSync(path)) readDeployedSettings(ctx, path);
}

/** Build the candidate settings bytes before the readiness-gated runtime cutover mutates disk. */
export function prepareClaudeSettings(
  ctx: Ctx,
  claudeDir: string,
  repo: Json,
): PreparedClaudeSettings {
  const path = p(claudeDir, "settings.json");
  if (!existsSync(path)) {
    // Write the form the next sync produces, so a second sync finds no change.
    const canonical = ctx.reconcile ? reconcileSettings(repo, {}) : mergeSettings(repo, {});
    const bytes = jqStringify(canonical);
    assertMaterializedSettings(bytes);
    return { path, bytes, previousBytes: undefined, changed: true };
  }

  // engineSync runs this check in preflightClaudeSettings; it stays here for other callers.
  const { text: previousBytes, doc: user } = readDeployedSettings(ctx, path);
  const merged = ctx.reconcile ? reconcileSettings(repo, user) : mergeSettings(repo, user);
  const bytes = jqStringify(merged);
  assertMaterializedSettings(bytes);
  return { path, bytes, previousBytes, changed: bytes !== previousBytes };
}

/**
 * Commit a fully prepared document; callers must finish runtime preparation first.
 * Returns true when the commit copied the previous settings to settings.json.bak.
 */
export function commitClaudeSettings(ctx: Ctx, prepared: PreparedClaudeSettings): boolean {
  const { change, verbose } = ctx.services.logger;
  if (!prepared.changed) {
    verbose("Settings already in sync");
    return false;
  }

  const backedUp = prepared.previousBytes !== undefined;
  if (backedUp) copyFileSync(prepared.path, `${prepared.path}.bak`);
  replaceFile(prepared.path, prepared.bytes);
  ctx.nextStepTriggers.claudeRestart = true;
  if (prepared.previousBytes === undefined) {
    change("Settings installed");
  } else if (ctx.reconcile) {
    change(
      "Settings reconciled (backup at settings.json.bak; user-only keys preserved, permissions arrays replaced by SoT)",
    );
  } else {
    change("Settings merged (backup at settings.json.bak)");
  }
  return backedUp;
}

export function describeSettingsSync(ctx: Ctx, claudeDir: string): void {
  const { echo } = ctx.services.logger;
  const repoSettings = payloadDisplayPath("SoT/.claude/settings.json");
  const userSettings = p(claudeDir, "settings.json");

  if (!existsSync(userSettings)) {
    echo(`[dry-run] install ${repoSettings} -> ${userSettings}`);
  } else if (ctx.reconcile) {
    echo(
      `[dry-run] reconcile ${repoSettings} -> ${userSettings} (SoT keys win; permissions arrays replaced; user-only keys preserved)`,
    );
  } else {
    echo(
      `[dry-run] merge ${repoSettings} -> ${userSettings} (SoT keys win; permissions arrays unioned; user-only keys preserved)`,
    );
  }
}

/** Shared shape of the three jq-edit modifiers (compact window, permissive). */
function jqEditSettings(
  ctx: Ctx,
  claudeDir: string,
  tag: string,
  edit: (doc: Json) => void,
): boolean {
  const { err, warn } = ctx.services.logger;
  const userSettings = p(claudeDir, "settings.json");
  if (!existsSync(userSettings)) {
    warn(`(${tag}) ${userSettings} missing — skipped`);
    return false;
  }
  const before = readFileSync(userSettings, "utf8");
  const doc = parseJson(before);
  if (doc === undefined) {
    err(`(${tag}) ${userSettings} is not valid JSON — skipped`);
    return false;
  }
  edit(doc);
  const out = jqStringify(doc);
  if (out === before) return false;
  replaceFile(userSettings, out);
  return true;
}

export function syncCompactWindow(ctx: Ctx, claudeDir: string): void {
  const { change, echo, verbose } = ctx.services.logger;
  if (ctx.claudeCompactWindow === "") return;

  if (ctx.dryRun) {
    echo(
      `[dry-run] (--claude-compact-window) set env.CLAUDE_CODE_AUTO_COMPACT_WINDOW=${ctx.claudeCompactWindow} in ${p(claudeDir, "settings.json")}`,
    );
    return;
  }

  const changed = jqEditSettings(ctx, claudeDir, "--claude-compact-window", (doc) => {
    if (!isObject(doc)) return;
    const env = isObject(doc["env"]) ? doc["env"] : {};
    env["CLAUDE_CODE_AUTO_COMPACT_WINDOW"] = ctx.claudeCompactWindow;
    doc["env"] = env;
  });
  if (changed) {
    change(
      `Compact window: set to ${ctx.claudeCompactWindow} tokens in deployed settings (SoT and model unchanged; flag-less sync reverts)`,
    );
    ctx.nextStepTriggers.claudeRestart = true;
  } else
    verbose(
      `Compact window: already set to ${ctx.claudeCompactWindow} tokens in deployed settings`,
    );
}

export function syncPermissive(ctx: Ctx, claudeDir: string): void {
  const { change, echo, verbose } = ctx.services.logger;
  if (!ctx.claudePermissive) return;

  if (ctx.dryRun) {
    echo(
      `[dry-run] (--claude-permissive) empty permissions.ask and permissions.deny in ${p(claudeDir, "settings.json")}`,
    );
    return;
  }

  const changed = jqEditSettings(ctx, claudeDir, "--claude-permissive", (doc) => {
    if (!isObject(doc)) return;
    const permissions = isObject(doc["permissions"]) ? doc["permissions"] : {};
    permissions["ask"] = [];
    permissions["deny"] = [];
    doc["permissions"] = permissions;
  });
  if (changed) {
    change(
      "Permissive mode: permissions.ask/deny emptied in deployed settings (sandbox use; SoT unchanged)",
    );
    ctx.nextStepTriggers.claudeRestart = true;
  } else verbose("Permissive mode: permissions.ask/deny already empty in deployed settings");
}
