/**
 * EngineNative skill ownership records under `~/.agents`:
 * - `.kit-pending-skills`, one slug per line: a slug whose install runs. Sync
 *   adds it before `npx skills add` only when the canonical skill directory
 *   does not exist. So it never names a directory that existed before the
 *   install.
 * - `.kit-owned-skills`, one `<slug>\t<dev>:<ino>` line per skill: the skills
 *   that the kit installed, with the identity of the directory that the
 *   install created. It is the only record that lets `--prune` remove a
 *   skill, and only while the directory keeps that identity.
 * - `.kit-managed-skills`: the legacy snapshot. An older kit also recorded
 *   directories that the user made there, so sync reads it and never writes
 *   it, and its entries never let `--prune` remove a skill.
 *
 * After each install, sync writes the owned record before the slug leaves the
 * pending record, and before the next install starts. So a sync that stops at
 * any point leaves each installed slug in one of the two records. The next
 * sync moves a leftover pending slug to the owned record when its directory
 * exists, and drops it otherwise.
 */
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
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
  /** Each owned slug and the `<dev>:<ino>` identity of the directory that its install created. */
  readonly owned: Map<string, string>;
  readonly pending: Set<string>;
  readonly legacy: ReadonlySet<string>;
}

/** The `<dev>:<ino>` identity of the entry at `path`, or undefined when no entry exists. */
export function directoryIdentity(path: string): string | undefined {
  // bigint keeps a Windows file index exact; a number loses digits above 2^53.
  const stats = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  return stats === undefined ? undefined : `${stats.dev}:${stats.ino}`;
}

function readSlugs(file: string): Set<string> {
  return new Set(existsSync(file) ? normalizeManifest(readFileSync(file, "utf8")) : []);
}

/**
 * Read the owned record. A line with no identity keeps the slug with an empty
 * identity, which matches no directory, so it never lets `--prune` remove one.
 */
function readOwned(file: string): Map<string, string> {
  const owned = new Map<string, string>();
  if (!existsSync(file)) return owned;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const [slug = "", identity = ""] = line.trim().split("\t");
    if (slug !== "") owned.set(slug, identity);
  }
  return owned;
}

function slugLines(slugs: ReadonlySet<string>): string {
  const sorted = [...slugs].sort(compareCodepoints);
  return sorted.length > 0 ? `${sorted.join("\n")}\n` : "";
}

function ownedLines(owned: ReadonlyMap<string, string>): string {
  const slugs = [...owned.keys()].sort(compareCodepoints);
  return slugs.map((slug) => `${slug}\t${owned.get(slug) ?? ""}\n`).join("");
}

export function readSkillRecords(agentsDir: string): SkillRecords {
  const ownedFile = p(agentsDir, ".kit-owned-skills");
  const pendingFile = p(agentsDir, ".kit-pending-skills");
  const legacyFile = p(agentsDir, ".kit-managed-skills");
  return {
    ownedFile,
    pendingFile,
    legacyFile,
    owned: readOwned(ownedFile),
    pending: readSlugs(pendingFile),
    legacy: readSlugs(legacyFile),
  };
}

/** True when the canonical skill directory of `slug` has no entry, so an install creates it. */
export function canonicalAbsent(skillsDir: string, slug: string): boolean {
  return lstat(p(skillsDir, skillBase(slug))) === undefined;
}

/**
 * Ends the pending state of `slug`. When its canonical directory exists, the
 * slug moves to the owned record with the identity of that directory. Else it
 * leaves the pending record. A slug that the owned record already names keeps
 * its identity. A sync that stopped between the two record writes leaves the
 * slug in both records, and the directory can change before the next sync.
 * Changes the records in memory only; `writeSkillRecords` writes them.
 */
export function settlePendingSlug(records: SkillRecords, skillsDir: string, slug: string): void {
  if (!records.pending.delete(slug) || records.owned.has(slug)) return;
  const canonical = p(skillsDir, skillBase(slug));
  const identity = isDir(canonical) ? directoryIdentity(canonical) : undefined;
  if (identity !== undefined) records.owned.set(slug, identity);
}

/**
 * Records `slug` as pending and writes the pending record before its install
 * starts. The canonical directory is gone, so an owned identity of the slug is
 * stale. It leaves the owned record first, so the install can record the new
 * directory.
 */
export function recordPendingInstall(records: SkillRecords, slug: string): void {
  if (records.owned.delete(slug)) {
    replaceTextIfChanged(records.ownedFile, ownedLines(records.owned));
  }
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
  const owned = ownedLines(records.owned);
  if (owned !== "" || existsSync(records.ownedFile)) {
    replaceTextIfChanged(records.ownedFile, owned);
  }
  if (records.pending.size > 0) {
    replaceTextIfChanged(records.pendingFile, slugLines(records.pending));
  } else {
    rmSync(records.pendingFile, { force: true });
  }
}
