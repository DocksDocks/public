/**
 * EngineNative `sync claude` retired-artifact pruning. The SoT no longer
 * ships the inventoried rules and artifacts, so this pass force-prunes them
 * from existing installations without `--reconcile`. Message strings and
 * prune semantics are part of the contract.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, renameSync, rmdirSync, rmSync } from "node:fs";
import { replaceFile } from "./atomicWrite";
import type { ClaudeRuntimeState } from "./claudeSync";
import { RETIRED_PERMISSION_RULES } from "./claudeRetired";
import { p } from "./exec";
import type { Ctx } from "./index";
import { isObject, jqStringify, parseJson, type Json } from "./jq";
import { lstat } from "./skillsLinks";

const REMOVED_MANIFEST = {
  hooks: ["disable-claudeai-connectors.sh"],
  files: ["alert_bubble.mp3"],
  settingsKeys: [
    "showTurnDuration",
    "advisorModel",
    "env.CLAUDE_CODE_SUBAGENT_MODEL",
    "env.ANTHROPIC_DEFAULT_OPUS_MODEL",
    "env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE",
    "env.CLAUDE_CODE_DISABLE_1M_CONTEXT",
    "env.CLAUDE_CODE_FORK_SUBAGENT",
    "env.CLAUDE_CODE_EFFORT_LEVEL",
    "enabledPlugins.effect-kit@docks",
    "enabledPlugins.session-relay@docks",
  ],
  permissionRules: {
    allow: ["Write(./)", "Bash(rtk *)", ...RETIRED_PERMISSION_RULES.allow],
    deny: [
      "Write(**/.env)",
      "Write(**/.env.local)",
      "Write(**/secrets/**)",
      ...RETIRED_PERMISSION_RULES.deny,
    ],
    ask: [...RETIRED_PERMISSION_RULES.ask],
  },
  claudeJsonKeys: [] as Array<string>,
  /** Home-relative artifacts the kit installed outside ~/.claude. */
  homeFiles: [".local/bin/effect-solutions", ".local/bin/session-relay"],
  runtimeReady: {
    hooks: ["notify.sh"],
    files: ["statusline.sh", "fetch-usage.sh"],
  },
};

/**
 * Hook handler commands that the kit shipped in SoT/.claude/settings.json and
 * then retired. The pass removes only these handlers, so user handlers on the
 * same events stay. The Stop pass runs only after the Bun runtime cutover.
 */
const RETIRED_HOOK_COMMANDS = {
  PreToolUse: ["$HOME/.claude/hooks/rtk-rewrite.sh", "rtk hook claude"],
  Stop: [
    "bash $HOME/.claude/fetch-usage.sh",
    "ffplay -nodisp -autoexit ~/.claude/alert_bubble.mp3",
    "ffplay -nodisp -autoexit https://raw.githubusercontent.com/DocksDocks/public/main/alert_bubble.mp3",
  ],
} as const;

type RetiredHookEvent = keyof typeof RETIRED_HOOK_COMMANDS;

/**
 * SHA-256 of every version of the runtime-ready artifacts that the kit
 * shipped, keyed by the path under ~/.claude. A copy with another hash is the
 * user's file, so the prune keeps it as `<path>.bak`.
 */
const LEGACY_ARTIFACT_HASHES: Readonly<Record<string, ReadonlyArray<string>>> = {
  "statusline.sh": [
    "292df944d7f28bacde854105891a270fbbe1a114172d0000d8d2c4366097c18d",
    "3a3ec8911c3916a1ba1fdf8ac5a8c4d8231ecc7dcd1f7355c7787603b9734efe",
    "8189f5fb83dfbbf864737a4613062912c0120659f01f56f61b0a3ed7ed69949c",
    "8dd0d6db2fcb9cec042756f9d14e09ee0214041b9d85fa5e26b8c99a06b65cd9",
    "b97abaf97874c7bc0b6052eb8f14f73bccff20c3b79f7d6b2ff79137daef360d",
    "baec096cbcf70245613a9ea10fe7cbdb50b16d02106b3cb6a0861a783b2de97c",
    "c7233f4006f603ee5431d02daf896a58167d20461171f9a1a329f8127ced4835",
  ],
  "fetch-usage.sh": [
    "304f5a17d9c4356ed7f3eedf7f38766b8e8e7fce91a80a6efbad0b8a6b43654d",
    "35531c6941d2e203f385baf6db9a9a17f57471ceadf91c6ee252b2f1aee0b456",
    "9b8fcac8bc3a45d505c58ca48013f4949a3a3d1cf5064872871286c2a81196f9",
    "ceaa5b5241edf639ca873439e1f1013b7e0d902a23d2bf831317e064a3ccab46",
  ],
  "hooks/notify.sh": [
    "2beb02119bd9bad3045341e12022fb7234b53b02c08908e4a9949968980f6e69",
    "90261530799aaf978949572521d2a73105a4104a47c86132a3815c26f0078216",
  ],
};

/** What retireArtifact did with one path. `suffix` names the backup, such as `.bak.1`. */
type ArtifactRetirement =
  | { readonly kind: "absent" }
  | { readonly kind: "removed" }
  | { readonly kind: "preserved"; readonly suffix: string };

/**
 * The first unoccupied backup suffix for `path`: `.bak`, then `.bak.1`,
 * `.bak.2`, and so on. The check uses lstat, so a dangling symlink occupies
 * its name.
 */
function freeBackupSuffix(path: string): string {
  let suffix = ".bak";
  for (let n = 1; lstat(`${path}${suffix}`) !== undefined; n++) suffix = `.bak.${n}`;
  return suffix;
}

/**
 * Retire one artifact. A path in LEGACY_ARTIFACT_HASHES is removed only when
 * its content matches a shipped version. Other content moves to the first
 * unoccupied backup name, so an earlier backup stays. A path without hashes
 * has a kit-only name and is removed. The presence check uses lstat, so a
 * dangling symlink is removed too.
 */
function retireArtifact(
  ctx: Ctx,
  path: string,
  shipped: ReadonlyArray<string> | undefined,
): ArtifactRetirement {
  const stats = lstat(path);
  if (stats === undefined) return { kind: "absent" };
  const owned =
    shipped === undefined ||
    (stats.isFile() &&
      shipped.includes(createHash("sha256").update(readFileSync(path)).digest("hex")));
  if (owned) {
    if (ctx.dryRun) ctx.services.logger.echo(`[dry-run] rm ${path}`);
    else rmSync(path, { force: true });
    return { kind: "removed" };
  }
  const suffix = freeBackupSuffix(path);
  if (ctx.dryRun) ctx.services.logger.echo(`[dry-run] mv ${path} ${path}${suffix}`);
  else renameSync(path, `${path}${suffix}`);
  return { kind: "preserved", suffix };
}

/**
 * Copy settings.json to settings.json.bak once per sync, just before the
 * first write of the removals pass. When an earlier pass of the same sync
 * already wrote the backup, the copy never runs, so that backup keeps the
 * original bytes.
 */
function settingsBackup(file: string, alreadyBackedUp: boolean): () => void {
  let done = alreadyBackedUp;
  return () => {
    if (done) return;
    copyFileSync(file, `${file}.bak`);
    done = true;
  };
}

/**
 * claude::_prune_json_keys — present-count; deletes when !dryRun. The pass
 * calls `beforeWrite` just before it writes the file.
 */
function pruneJsonKeys(
  ctx: Ctx,
  file: string,
  keys: Array<string>,
  beforeWrite: () => void,
): number {
  if (keys.length === 0 || !existsSync(file)) return 0;
  const doc = parseJson(readFileSync(file, "utf8"));
  if (doc === undefined) return 0;

  const hasPath = (root: Json, path: Array<string>): boolean => {
    let cur: Json = root;
    for (const seg of path.slice(0, -1)) {
      if (!isObject(cur) || cur[seg] === undefined) return false;
      cur = cur[seg]!;
    }
    return isObject(cur) && Object.prototype.hasOwnProperty.call(cur, path[path.length - 1]!);
  };
  const presentKeys = keys.filter((k) => hasPath(doc, k.split(".")));
  if (presentKeys.length === 0) return 0;

  if (!ctx.dryRun) {
    for (const k of presentKeys) {
      const path = k.split(".");
      let cur: Json = doc;
      for (const seg of path.slice(0, -1)) {
        if (!isObject(cur)) break;
        cur = cur[seg]!;
      }
      if (isObject(cur)) delete cur[path[path.length - 1]!];
    }
    beforeWrite();
    replaceFile(file, jqStringify(doc));
  }
  return presentKeys.length;
}

function prunePermissionRules(
  ctx: Ctx,
  file: string,
  rules: Readonly<Record<"allow" | "deny" | "ask", ReadonlyArray<string>>>,
  beforeWrite: () => void,
): number {
  if (!existsSync(file)) return 0;
  const doc = parseJson(readFileSync(file, "utf8"));
  if (doc === undefined || !isObject(doc) || !isObject(doc["permissions"])) return 0;
  const permissions = doc["permissions"];
  let present = 0;
  for (const key of ["allow", "deny", "ask"] as const) {
    const values = permissions[key];
    if (!Array.isArray(values)) continue;
    const removed = new Set(rules[key]);
    present += rules[key].filter((rule) => values.includes(rule)).length;
    if (!ctx.dryRun)
      permissions[key] = values.filter((value) => typeof value !== "string" || !removed.has(value));
  }
  if (present > 0 && !ctx.dryRun) {
    beforeWrite();
    replaceFile(file, jqStringify(doc));
  }
  return present;
}

/**
 * Remove the retired kit handlers from the named hook events. A group that
 * loses all its handlers is dropped, and an event with no groups left is
 * dropped. A null or non-array event value is dropped too. The pass calls
 * `beforeWrite` just before it writes the file. Returns the count of removed
 * entries.
 */
function pruneRetiredHookHandlers(
  ctx: Ctx,
  file: string,
  events: ReadonlyArray<RetiredHookEvent>,
  beforeWrite: () => void,
): number {
  if (!existsSync(file)) return 0;
  const doc = parseJson(readFileSync(file, "utf8"));
  if (doc === undefined || !isObject(doc) || !isObject(doc["hooks"])) return 0;
  const hooks = doc["hooks"];
  let removed = 0;
  for (const event of events) {
    const groups = hooks[event];
    if (groups === undefined) continue;
    if (!Array.isArray(groups)) {
      delete hooks[event];
      removed++;
      continue;
    }
    const retired: ReadonlyArray<string> = RETIRED_HOOK_COMMANDS[event];
    let removedFromEvent = 0;
    const kept: Array<Json> = [];
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group["hooks"])) {
        kept.push(group);
        continue;
      }
      const handlers = group["hooks"].filter(
        (handler) =>
          !isObject(handler) ||
          handler["type"] !== "command" ||
          typeof handler["command"] !== "string" ||
          !retired.includes(handler["command"]),
      );
      const count = group["hooks"].length - handlers.length;
      removedFromEvent += count;
      if (count === 0) kept.push(group);
      else if (handlers.length > 0) kept.push({ ...group, hooks: handlers });
    }
    if (removedFromEvent === 0) continue;
    removed += removedFromEvent;
    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }
  if (removed > 0 && !ctx.dryRun) {
    beforeWrite();
    replaceFile(file, jqStringify(doc));
  }
  return removed;
}

/**
 * Prune retired artifacts, settings keys, permission rules, and hook handlers.
 * `settingsBackedUp` is true when an earlier pass of this sync already copied
 * settings.json to settings.json.bak. The pass then keeps that backup.
 */
export function syncRemovals(
  ctx: Ctx,
  claudeDir: string,
  runtime: ClaudeRuntimeState,
  settingsBackedUp: boolean,
): void {
  const { change, echo } = ctx.services.logger;
  const ready = runtime.kind === "ready";
  let hooksRemoved = 0;
  let filesRemoved = 0;
  const preserved: Array<string> = [];
  const hooks = [...REMOVED_MANIFEST.hooks, ...(ready ? REMOVED_MANIFEST.runtimeReady.hooks : [])];
  const files = [...REMOVED_MANIFEST.files, ...(ready ? REMOVED_MANIFEST.runtimeReady.files : [])];
  const settingsKeys = REMOVED_MANIFEST.settingsKeys.filter(
    (key) => key !== "advisorModel" || ctx.claudeAdvisor === "",
  );
  const hookEvents: Array<RetiredHookEvent> = ready ? ["PreToolUse", "Stop"] : ["PreToolUse"];

  for (const name of hooks) {
    const label = `hooks/${name}`;
    const result = retireArtifact(ctx, p(claudeDir, "hooks", name), LEGACY_ARTIFACT_HASHES[label]);
    if (result.kind === "removed") hooksRemoved++;
    else if (result.kind === "preserved") preserved.push(`${label}${result.suffix}`);
  }
  if (!ctx.dryRun && hooksRemoved > 0) {
    try {
      rmdirSync(p(claudeDir, "hooks"));
    } catch {
      // Preserve a non-empty user hooks directory.
    }
  }

  const filePaths = [
    ...files.map((rel) => ({
      path: p(claudeDir, rel),
      label: rel,
      shipped: LEGACY_ARTIFACT_HASHES[rel],
    })),
    ...REMOVED_MANIFEST.homeFiles.map((rel) => ({
      path: p(ctx.home, rel),
      label: `~/${rel}`,
      shipped: undefined,
    })),
  ];
  for (const { path, label, shipped } of filePaths) {
    const result = retireArtifact(ctx, path, shipped);
    if (result.kind === "removed") filesRemoved++;
    else if (result.kind === "preserved") preserved.push(`${label}${result.suffix}`);
  }

  const settingsPath = p(claudeDir, "settings.json");
  const backup = settingsBackup(settingsPath, settingsBackedUp);
  const skeys = pruneJsonKeys(ctx, settingsPath, settingsKeys, backup);
  const permissionRules = prunePermissionRules(
    ctx,
    settingsPath,
    REMOVED_MANIFEST.permissionRules,
    backup,
  );
  const hookHandlers = pruneRetiredHookHandlers(ctx, settingsPath, hookEvents, backup);
  const cjkeys = pruneJsonKeys(
    ctx,
    p(ctx.home, ".claude.json"),
    REMOVED_MANIFEST.claudeJsonKeys,
    () => {},
  );

  if (ctx.dryRun) {
    if (skeys > 0)
      echo(`[dry-run] del ${skeys} stale key(s) from ${p(claudeDir, "settings.json")}`);
    if (permissionRules > 0) {
      echo(
        `[dry-run] del ${permissionRules} stale permission rule(s) from ${p(claudeDir, "settings.json")}`,
      );
    }
    if (hookHandlers > 0) {
      echo(
        `[dry-run] del ${hookHandlers} retired hook handler(s) from ${p(claudeDir, "settings.json")}`,
      );
    }
    if (cjkeys > 0)
      echo(`[dry-run] del ${cjkeys} stale key(s) from ${p(ctx.home, ".claude.json")}`);
    return;
  }

  const artifacts = hooksRemoved + filesRemoved + preserved.length;
  if (artifacts + skeys + permissionRules + hookHandlers + cjkeys > 0) {
    const permissionSummary = permissionRules > 0 ? `, permission rules: ${permissionRules}` : "";
    const handlerSummary = hookHandlers > 0 ? `, retired hook handlers: ${hookHandlers}` : "";
    const preservedSummary =
      preserved.length > 0
        ? `, preserved as backup: ${preserved.length} (${preserved.join(", ")})`
        : "";
    change(
      `Pruned stale artifacts (hooks: ${hooksRemoved}, files: ${filesRemoved}, settings keys: ${skeys}, claude.json keys: ${cjkeys}${permissionSummary}${handlerSummary}${preservedSummary})`,
    );
    ctx.nextStepTriggers.claudeRestart = true;
  }
}
