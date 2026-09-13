/**
 * EngineNative `sync agents` pipeline: universal-skill bootstrap
 * (`npx skills@<pin> add`), Claude symlink healing, --prune reconcile against
 * the kit-managed snapshot, and the snapshot write.
 *
 * Split: manifest parsing lives in `skillsManifest.ts`, link mechanics and
 * healing in `skillsLinks.ts`, the install pass in `skillsInstall.ts`, and
 * prune plus snapshot tracking in `skillsPrune.ts`. This module keeps the
 * orchestration and re-exports the public surface so existing import paths
 * keep working.
 */
import { mkdirSync } from "node:fs";
import { payloadText } from "../payload";
import { p } from "./exec";
import type { Ctx } from "./index";
import { syncUniversal, type SkillsState } from "./skillsInstall";
import { reconcileRemovals, updateSnapshot } from "./skillsPrune";

export type { SkillsState } from "./skillsInstall";
export { COPY_MARKER, linkOrCopy, type LinkOutcome } from "./skillsLinks";
export { normalizeManifest } from "./skillsManifest";

export async function skillsSync(ctx: Ctx): Promise<SkillsState> {
  const state: SkillsState = { present: 0 };
  const skillsDir = p(ctx.agentsDir, "skills");
  const manifest = payloadText("SoT/.agents/skills.txt");
  const snapshot = p(ctx.agentsDir, ".kit-managed-skills");

  if (!ctx.dryRun) mkdirSync(skillsDir, { recursive: true });

  await syncUniversal(ctx, state, skillsDir, manifest);
  const failedRemovals = ctx.prune ? await reconcileRemovals(ctx, manifest, snapshot) : [];
  updateSnapshot(ctx, manifest, snapshot, failedRemovals);
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
