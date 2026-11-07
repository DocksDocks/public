/**
 * EngineNative kit skill prune (`--prune` reconcile against the owned record
 * of `skillsRecords.ts`). Split from skillsSync.ts; the orchestration still
 * lives there.
 *
 * The prune deletes only what the kit created: the canonical skill directory
 * of a slug in `.kit-owned-skills` and the kit-managed Claude entry. It
 * removes a canonical directory only while it keeps the `<dev>:<ino>` that
 * the owned record names. It does not call `skills remove`, because that
 * command deletes the same-named directory of every known agent. A slug that
 * only the legacy `.kit-managed-skills` names is kept with a message, because
 * an older kit also recorded directories that the user made.
 */
import { existsSync, rmSync } from "node:fs";
import { p } from "./exec";
import type { Ctx } from "./index";
import { compareCodepoints } from "./jq";
import { isKitOwnedCopy, lstat, removeKitOwnedCopy, removeLink } from "./skillsLinks";
import { normalizeManifest, skillBase } from "./skillsManifest";
import { directoryIdentity, type SkillRecords } from "./skillsRecords";

function removeCanonical(path: string): boolean {
  try {
    rmSync(path, { recursive: true, force: true });
    return true;
  } catch {
    return lstat(path) === undefined;
  }
}

/**
 * Removes each owned skill that the SoT no longer declares, and drops it from
 * `records.owned` (in memory). A failed removal keeps the slug, so the next
 * prune tries again. An owned slug whose directory is not the one that the
 * kit installed is kept with a line. It leaves the record, so the line prints
 * once. A legacy slug that the SoT dropped gets a keep line while its
 * canonical path still has an entry. Only the legacy record names it, so the
 * kit keeps it.
 */
export function reconcileRemovals(ctx: Ctx, manifest: string, records: SkillRecords): void {
  const { change, echo, warn } = ctx.services.logger;
  if (ctx.dryRun && !existsSync(records.ownedFile)) {
    echo(
      `[dry-run] (--prune) no kit-owned-skills record yet; a sync writes ${records.ownedFile} when it installs a skill, and --prune removes only the skills that it names`,
    );
  }

  const current = normalizeManifest(manifest);
  const currentBases = new Set(current.map(skillBase));
  const declared = (slug: string): boolean =>
    current.includes(slug) || currentBases.has(skillBase(slug));

  for (const slug of [...records.legacy].sort(compareCodepoints)) {
    if (declared(slug) || records.owned.has(slug)) continue;
    if (lstat(p(ctx.agentsDir, "skills", skillBase(slug))) === undefined) continue;
    warn(
      `keep ${slug}: an older kit recorded it, so the kit cannot prove it installed it; remove it by hand if the kit did`,
    );
  }

  let removed = 0;
  let failed = 0;
  for (const slug of [...records.owned.keys()].sort(compareCodepoints)) {
    if (declared(slug)) continue;
    const base = skillBase(slug);
    const canonical = p(ctx.agentsDir, "skills", base);
    // The skills CLI installs a canonical skill as a real directory that holds
    // SKILL.md. A gone directory needs only the Claude entry cleanup.
    const canonicalStat = lstat(canonical);
    const installedCanonical =
      canonicalStat?.isDirectory() === true &&
      existsSync(p(canonical, "SKILL.md")) &&
      directoryIdentity(canonical) === records.owned.get(slug);
    if (canonicalStat !== undefined && !installedCanonical) {
      warn(`keep ${slug}: the directory is not the one that the kit installed`);
      if (!ctx.dryRun) records.owned.delete(slug);
      continue;
    }
    const claudeEntry = p(ctx.home, ".claude", "skills", base);
    const managedClaudeEntry =
      lstat(claudeEntry)?.isSymbolicLink() === true || isKitOwnedCopy(claudeEntry);
    if (ctx.dryRun) {
      echo(`[dry-run] kit-managed skill no longer in SoT — would remove: ${base}`);
      if (managedClaudeEntry) {
        echo(`[dry-run] kit-managed Claude skill entry — would remove: ~/.claude/skills/${base}`);
      }
      continue;
    }
    if (installedCanonical && !removeCanonical(canonical)) {
      warn(`Failed to remove kit-managed skill: ${base}`);
      failed++;
      continue;
    }
    if (managedClaudeEntry) {
      const entryStat = lstat(claudeEntry);
      const removedClaudeEntry =
        entryStat === undefined ||
        (entryStat.isSymbolicLink() ? removeLink(claudeEntry) : removeKitOwnedCopy(claudeEntry));
      if (!removedClaudeEntry) {
        warn(`Failed to remove kit-managed Claude skill entry: ${base}`);
        failed++;
        continue;
      }
    }
    records.owned.delete(slug);
    removed++;
  }

  if (removed > 0) {
    change(`Kit-managed skills removed (-${removed})`);
    ctx.nextStepTriggers.skillsRestart = true;
  }
  if (failed > 0)
    warn(
      `${failed} skill remove(s) failed — re-run with --prune, or delete ~/.agents/skills/<name> and the ~/.claude/skills/<name> link manually`,
    );
}
