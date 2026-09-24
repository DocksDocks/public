/**
 * EngineNative pipeline dispatch: select the requested harness pipelines,
 * run them under the concurrency cap, then print the summary and advice.
 * Split from index.ts; the `sync`/`model`/`toolchain` entry routing still
 * lives there.
 */
import { payloadText } from "../payload";
import { claudeNextSteps, claudeSummary, claudeSync, type ClaudeRuntimeState } from "./claudeSync";
import { codexNextSteps, codexSummary, codexSync } from "./codexSync";
import type { Ctx } from "./index";
import { ompNextSteps, ompSummary, ompSync, type OmpState } from "./ompSync";
import { skillsNextSteps, skillsSummary, skillsSync, type SkillsState } from "./skillsSync";
import { ExitError, parseArgs, validateModifierFlags } from "./parseArgs";
import {
  runBounded,
  syncConcurrencyForManifest,
  type SyncConcurrency,
  type SyncTask,
} from "./syncConcurrency";

export async function engineSync(ctx: Ctx, args: ReadonlyArray<string>): Promise<number> {
  const { acquireTerminal, echo, err } = ctx.services.logger;
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
  let results: Array<PipelineResult>;
  try {
    const tasks = selected.map(({ name, run }): SyncTask<PipelineResult> => async () => {
      try {
        return await run();
      } finally {
        remaining.delete(name);
        if (remaining.size > 0) lease.update(`Syncing ${[...remaining].join(", ")}...`);
      }
    });
    results = await runBounded(tasks, ctx.syncConcurrency);
  } finally {
    lease.release();
    ctx.terminalLease = undefined;
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
  if (ctx.failures.length > 0) {
    echo("");
    echo("--- Failures ---");
    for (const failure of ctx.failures) echo(`- ${failure}`);
    return 1;
  }
  return 0;
}
