/**
 * EngineNative skill ownership records under `~/.agents`, one slug per line:
 * - `.kit-pending-skills`: a slug whose install runs. Sync adds it before
 *   `npx skills add` only when the canonical skill directory does not exist,
 *   so it never names a directory that existed before the install.
 * - `.kit-owned-skills`: the skills that the kit installed. It is the only
 *   record that lets `--prune` remove a skill.
 * - `.kit-managed-skills`: the legacy snapshot. An older kit also recorded
 *   directories that the user made there, so sync reads it and never writes
 *   it, and its entries never let `--prune` remove a skill.
 *
 * A sync that stops after an install and before the owned record write keeps
 * the slug in the pending record. The next sync moves such a slug to the owned
 * record when its directory exists, and drops it otherwise.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { replaceTextIfChanged } from "./atomicWrite";
import { p } from "./exec";
import type { Ctx } from "./index";
import { compareCodepoints } from "./jq";
import { isDir, lstat } from "./skillsLinks";
import { normalizeManifest, skillBase } from "./skillsManifest";

export interface SkillRecords {
  readonly ownedFile: string;
  readonly pendingFile: string;
  readonly legacyFile: string;
  readonly owned: Set<string>;
  readonly pending: Set<string>;
  readonly legacy: ReadonlySet<string>;
}

function readSlugs(file: string): Set<string> {
  return new Set(existsSync(file) ? normalizeManifest(readFileSync(file, "utf8")) : []);
}

function slugLines(slugs: ReadonlySet<string>): string {
  const sorted = [...slugs].sort(compareCodepoints);
  return sorted.length > 0 ? `${sorted.join("\n")}\n` : "";
}

export function readSkillRecords(agentsDir: string): SkillRecords {
  const ownedFile = p(agentsDir, ".kit-owned-skills");
  const pendingFile = p(agentsDir, ".kit-pending-skills");
  const legacyFile = p(agentsDir, ".kit-managed-skills");
  return {
    ownedFile,
    pendingFile,
    legacyFile,
    owned: readSlugs(ownedFile),
    pending: readSlugs(pendingFile),
    legacy: readSlugs(legacyFile),
  };
}

/** True when the canonical skill directory of `slug` has no entry, so an install creates it. */
export function canonicalAbsent(skillsDir: string, slug: string): boolean {
  return lstat(p(skillsDir, skillBase(slug))) === undefined;
}

/**
 * Ends the pending state of `slug`: it moves to the owned record when its
 * canonical directory exists, else it leaves the pending record. Changes the
 * records in memory only; `writeSkillRecords` writes them.
 */
export function settlePendingSlug(records: SkillRecords, skillsDir: string, slug: string): void {
  if (!records.pending.delete(slug)) return;
  if (isDir(p(skillsDir, skillBase(slug)))) records.owned.add(slug);
}

/** Records `slug` as pending and writes the pending record before its install starts. */
export function recordPendingInstall(records: SkillRecords, slug: string): void {
  records.pending.add(slug);
  replaceTextIfChanged(records.pendingFile, slugLines(records.pending));
}

/**
 * Writes the owned record, then the pending record, so a sync that stops
 * between the two writes keeps the pending slugs for the next sync. An empty
 * pending record is removed. Writes nothing under dry run.
 */
export function writeSkillRecords(ctx: Ctx, records: SkillRecords): void {
  if (ctx.dryRun) return;
  const owned = slugLines(records.owned);
  if (owned !== "" || existsSync(records.ownedFile)) {
    replaceTextIfChanged(records.ownedFile, owned);
  }
  if (records.pending.size > 0) {
    replaceTextIfChanged(records.pendingFile, slugLines(records.pending));
  } else {
    rmSync(records.pendingFile, { force: true });
  }
}
