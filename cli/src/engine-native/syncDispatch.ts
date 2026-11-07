/**
 * EngineNative pipeline dispatch: select the requested harness pipelines,
 * run them under the concurrency cap, then print the summary and advice.
 * Split from index.ts; the `sync`/`model`/`toolchain` entry routing still
 * lives there.
 */
import { mkdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

import { payloadText } from "../payload";
import { claudeNextSteps, claudeSummary, claudeSync, type ClaudeRuntimeState } from "./claudeSync";
import { preflightClaudeSettings } from "./claudeSettings";
import { codexHome } from "./codexPaths";
import { codexNextSteps, codexSummary, codexSync } from "./codexSync";
import type { Ctx } from "./index";
import { compareCodepoints } from "./jq";
import { acquireKitLock, releaseKitLock, type KitLock } from "./kitLock";
import { ompNextSteps, ompSummary, ompSync, type OmpState } from "./ompSync";
import { skillsNextSteps, skillsSummary, skillsSync, type SkillsState } from "./skillsSync";
import { ExitError, parseArgs, validateModifierFlags } from "./parseArgs";
import { folderSyncLockPath, syncLockPath } from "./scratch";
import {
  runBounded,
  syncConcurrencyForManifest,
  type SyncConcurrency,
  type SyncTask,
} from "./syncConcurrency";

/** The default time that a sync or a model write waits for another sync to release the sync lock. */
export const SYNC_LOCK_WAIT_MS = 120_000;
const SYNC_LOCK_WAIT_ERROR = "DOCKS_KIT_SYNC_LOCK_WAIT_MS must be a non-negative safe integer";

/**
 * The sync lock wait bound: `DOCKS_KIT_SYNC_LOCK_WAIT_MS` in ms, or
 * `SYNC_LOCK_WAIT_MS` when unset or empty. A value above
 * `Number.MAX_SAFE_INTEGER` exits 2: `Number` would round it or make it
 * Infinity, and an Infinity wait never ends.
 */
function syncLockWaitMs(ctx: Ctx): number {
  const configured = process.env["DOCKS_KIT_SYNC_LOCK_WAIT_MS"];
  if (configured === undefined || configured === "") return SYNC_LOCK_WAIT_MS;
  if (/^\d+$/.test(configured) && Number.isSafeInteger(Number(configured))) {
    return Number(configured);
  }
  ctx.services.logger.err(SYNC_LOCK_WAIT_ERROR);
  throw new ExitError(2);
}

/**
 * The tokens that skip the sync lock. `-h` and `--help` make `parseArgs`
 * print the usage or an error and exit before it reads `kit.db`. A
 * `--dry-run` sync writes no kit file except a `kit.db` migration, which
 * `kitDb.ts` makes safe for parallel runs.
 */
const UNLOCKED_TOKENS: Record<string, true> = { "--dry-run": true, "-h": true, "--help": true };

/**
 * Run `body` under each lock of `paths`, taken in that order. When another
 * sync keeps a lock past the wait bound, print the held line and return 1
 * without a call to `body`. Each taken lock goes when the run ends, also when
 * it throws; the OS releases the locks when the process ends.
 */
async function withKitLocks(
  ctx: Ctx,
  paths: ReadonlyArray<string>,
  privateDirectory: boolean,
  body: () => Promise<number>,
): Promise<number> {
  const waitMs = syncLockWaitMs(ctx);
  const held: Array<KitLock> = [];
  try {
    for (const path of paths) {
      const result = await acquireKitLock(path, { waitMs, privateDirectory });
      if (result.kind === "held") {
        ctx.services.logger.err(
          `another docks-kit sync holds ${path}; run sync again after it ends`,
        );
        return 1;
      }
      held.push(result.lock);
    }
    return await body();
  } finally {
    for (const lock of held.reverse()) releaseKitLock(lock);
  }
}

/**
 * Run `body` under the sync lock `syncLockPath(ctx.home)`, unless `args` holds
 * one of `UNLOCKED_TOKENS`. Two syncs of the same home meet at this lock.
 */
export async function withSyncLock(
  ctx: Ctx,
  args: ReadonlyArray<string>,
  body: () => Promise<number>,
): Promise<number> {
  if (args.some((arg) => Object.hasOwn(UNLOCKED_TOKENS, arg))) return await body();
  return await withKitLocks(ctx, [syncLockPath(ctx.home)], true, body);
}

/**
 * The folder lock path of each folder, by the real path of the folder, with
 * no duplicates, in sorted order. Every sync takes its folder locks in this
 * order, so no two syncs can wait on each other in a cycle. Each folder must
 * exist.
 */
export function folderLockPaths(folders: ReadonlyArray<string>): Array<string> {
  const paths = new Set(folders.map((folder) => folderSyncLockPath(realpathSync.native(folder))));
  return [...paths].sort(compareCodepoints);
}

/**
 * Run `body` under the folder lock of each folder in `folders`. Take it after
 * the sync lock. Syncs of different homes can share a Codex or agents folder
 * through `CODEX_HOME` or `AGENTS_DIR`, and their home locks differ. A dry run
 * takes no folder lock. Each folder must exist.
 */
export async function withFolderLocks(
  ctx: Ctx,
  folders: ReadonlyArray<string>,
  body: () => Promise<number>,
): Promise<number> {
  if (ctx.dryRun) return await body();
  return await withKitLocks(ctx, folderLockPaths(folders), false, body);
}

/**
 * Run a sync. The sync lock comes first: `parseArgs` reads the harness
 * selection from `kit.db`, and that read can migrate `kit.db` and rename a
 * legacy `state.json`. The folder locks come after `parseArgs` selects the
 * targets.
 */
export async function engineSync(ctx: Ctx, args: ReadonlyArray<string>): Promise<number> {
  return await withSyncLock(ctx, args, () => runSync(ctx, args));
}

async function runSync(ctx: Ctx, args: ReadonlyArray<string>): Promise<number> {
  const { err } = ctx.services.logger;
  parseArgs(ctx, args);
  await validateModifierFlags(ctx);
  const configuredConcurrency = process.env["DOCKS_KIT_SYNC_CONCURRENCY"];
  if (configuredConcurrency === undefined || configuredConcurrency === "") {
    ctx.syncConcurrency = 3;
  } else if (
    configuredConcurrency === "1" ||
    configuredConcurrency === "2" ||
    configuredConcurrency === "3"
  ) {
    ctx.syncConcurrency = Number(configuredConcurrency) as SyncConcurrency;
  } else {
    err("DOCKS_KIT_SYNC_CONCURRENCY must be 1, 2, or 3");
    throw new ExitError(2);
  }

  // The folders that hold ownership records. A writing Codex or agents
  // pipeline creates its folder anyway, so the lock can create it first.
  const folders = [
    ...(ctx.syncCodex ? [codexHome(ctx.home)] : []),
    ...(ctx.syncAgents ? [resolve(ctx.agentsDir)] : []),
  ];
  if (!ctx.dryRun) for (const folder of folders) mkdirSync(folder, { recursive: true });
  return await withFolderLocks(ctx, folders, () => runPipelines(ctx));
}

async function runPipelines(ctx: Ctx): Promise<number> {
  const { acquireTerminal, echo } = ctx.services.logger;
  // An abort-class check runs before any pipeline starts, so the abort stops the whole sync.
  preflightClaudeSettings(ctx);

  type PipelineResult =
    | { readonly kind: "claude"; readonly runtime: ClaudeRuntimeState }
    | { readonly kind: "codex" }
    | { readonly kind: "skills"; readonly state: SkillsState }
    | { readonly kind: "omp"; readonly state: OmpState };
  interface SelectedPipeline {
    readonly name: string;
    readonly run: SyncTask<PipelineResult>;
  }

  const selected: Array<SelectedPipeline> = [];
  if (ctx.syncClaude) {
    selected.push({
      name: "Claude",
      run: async () => ({ kind: "claude", runtime: await claudeSync(ctx) }),
    });
  }
  if (ctx.syncCodex) {
    selected.push({
      name: "Codex",
      run: async () => {
        await codexSync(ctx);
        return { kind: "codex" };
      },
    });
  }
  if (ctx.syncAgents) {
    selected.push({
      name: "skills",
      run: async () => ({ kind: "skills", state: await skillsSync(ctx) }),
    });
  }
  if (ctx.syncOmp) {
    selected.push({
      name: "omp",
      run: async () => ({ kind: "omp", state: await ompSync(ctx) }),
    });
  }

  // A populated skills manifest deploys with `-a claude-code codex`, and symlink healing also writes into Claude's tree.
  ctx.syncConcurrency = syncConcurrencyForManifest(
    ctx.syncConcurrency,
    payloadText("SoT/.agents/skills.txt"),
    ctx.syncClaude,
    ctx.syncAgents,
  );

  const remaining = new Set(selected.map(({ name }) => name));
  const lease = acquireTerminal(`Syncing ${[...remaining].join(", ")}...`);
  ctx.terminalLease = lease;
  const tasks = selected.map(({ name, run }): SyncTask<PipelineResult> => async () => {
    try {
      return await run();
    } finally {
      remaining.delete(name);
      if (remaining.size > 0) lease.update(`Syncing ${[...remaining].join(", ")}...`);
    }
  });
  let results: Array<PipelineResult>;
  try {
    try {
      results = await runBounded(tasks, ctx.syncConcurrency);
    } finally {
      lease.release();
      ctx.terminalLease = undefined;
    }
  } catch (error) {
    // A rejected pipeline skips the summary. Print the failures that the other pipelines recorded.
    printFailures(ctx);
    throw error;
  }

  const claudeRan = ctx.syncClaude;
  const codexRan = ctx.syncCodex;
  let claudeRuntime: ClaudeRuntimeState | undefined;
  let skillsState: SkillsState | undefined;
  let ompState: OmpState | undefined;
  for (const result of results) {
    if (result.kind === "claude") claudeRuntime = result.runtime;
    else if (result.kind === "skills") skillsState = result.state;
    else if (result.kind === "omp") ompState = result.state;
  }

  echo("");
  echo("--- Sync complete ---");
  echo(`Repo:     ${ctx.repoDir}`);
  if (claudeRuntime !== undefined) claudeSummary(ctx, claudeRuntime);
  if (codexRan) codexSummary(ctx);
  if (skillsState !== undefined) skillsSummary(ctx, skillsState);
  if (ompState !== undefined) ompSummary(ctx, ompState);

  const advice = [
    ...(claudeRan ? claudeNextSteps(ctx) : []),
    ...(codexRan ? codexNextSteps(ctx) : []),
    ...(skillsState !== undefined ? skillsNextSteps(ctx) : []),
    ...(ompState !== undefined ? ompNextSteps(ctx) : []),
  ];
  if (advice.length > 0) {
    echo("");
    for (const line of advice) echo(line);
  }
  if (printFailures(ctx)) return 1;
  return 0;
}

/** Print the `--- Failures ---` ledger. Returns true when the ledger has entries. */
function printFailures(ctx: Ctx): boolean {
  const { echo } = ctx.services.logger;
  if (ctx.failures.length === 0) return false;
  echo("");
  echo("--- Failures ---");
  for (const failure of ctx.failures) echo(`- ${failure}`);
  return true;
}
