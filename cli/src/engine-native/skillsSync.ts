/**
 * EngineNative `sync agents` pipeline: universal-skill bootstrap
 * (`npx skills@<pin> add`), Claude symlink healing, --prune reconcile against
 * the kit-owned record, and the record writes.
 *
 * Split: manifest parsing lives in `skillsManifest.ts`, link mechanics and
 * healing in `skillsLinks.ts`, the install pass in `skillsInstall.ts`, the
 * ownership records in `skillsRecords.ts`, and the prune in `skillsPrune.ts`.
 * This module keeps the orchestration and re-exports the public surface so
 * existing import paths keep working.
 */
import { mkdirSync } from "node:fs";
import { payloadText } from "../payload";
import { p } from "./exec";
import type { Ctx } from "./index";
import { syncUniversal, type SkillsState } from "./skillsInstall";
import { reconcileRemovals } from "./skillsPrune";
import { readSkillRecords, settlePendingSlug, writeSkillRecords } from "./skillsRecords";

export type { SkillsState } from "./skillsInstall";
export { COPY_MARKER, linkOrCopy, type LinkOutcome } from "./skillsLinks";
export { normalizeManifest } from "./skillsManifest";

export async function skillsSync(ctx: Ctx): Promise<SkillsState> {
  const state: SkillsState = { present: 0 };
  const skillsDir = p(ctx.agentsDir, "skills");
  const manifest = payloadText("SoT/.agents/skills.txt");
  const records = readSkillRecords(ctx.agentsDir);

  if (!ctx.dryRun) mkdirSync(skillsDir, { recursive: true });

  // A pending slug that an earlier sync left: its install ran, but its record did not.
  for (const slug of [...records.pending]) settlePendingSlug(records, skillsDir, slug);
  writeSkillRecords(ctx, records);

  await syncUniversal(ctx, state, skillsDir, manifest, records);
  // An owned slug leaves the record only after a successful --prune removes it.
  if (ctx.prune) reconcileRemovals(ctx, manifest, records);
  writeSkillRecords(ctx, records);
  return state;
}

// -------------------------------------------------------------- summary ----

export function skillsSummary(ctx: Ctx, state: SkillsState): void {
  const { echo } = ctx.services.logger;
  echo(`Skills:   ${p(ctx.agentsDir, "skills")}`);
  if (!ctx.dryRun) {
    echo(`          ${state.present} universal skill(s) installed`);
  }
}

export function skillsNextSteps(ctx: Ctx): Array<string> {
  return ctx.verbose || ctx.nextStepTriggers.skillsRestart
    ? ["Restart Claude Code (and Codex) to discover newly installed universal skills."]
    : [];
}
