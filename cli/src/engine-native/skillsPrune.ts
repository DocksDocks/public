/**
 * EngineNative kit-managed skill prune (`--prune` reconcile against the
 * snapshot) and snapshot write. Split from skillsSync.ts; the orchestration
 * still lives there.
 *
 * The prune deletes only what the kit created: the canonical skill directory
 * and the kit-managed Claude entry. It does not call `skills remove`, because
 * that command deletes the same-named directory of every known agent.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { p, writeTextIfChanged } from "./exec";
import type { Ctx } from "./index";
import { compareCodepoints } from "./jq";
import { isKitOwnedCopy, lstat, removeKitOwnedCopy, removeLink } from "./skillsLinks";
import { normalizeManifest, skillBase } from "./skillsManifest";

// ----------------------------------------------------- prune + snapshot ----

export function readSlugs(file: string): Array<string> {
  return existsSync(file) ? normalizeManifest(readFileSync(file, "utf8")) : [];
}

function removeCanonical(path: string): boolean {
  try {
    rmSync(path, { recursive: true, force: true });
    return true;
  } catch {
    return lstat(path) === undefined;
  }
}

export function reconcileRemovals(ctx: Ctx, manifest: string, snapshot: string): Array<string> {
  const { change, echo, warn } = ctx.services.logger;
  if (!existsSync(snapshot)) {
    if (ctx.dryRun) {
      echo(
        `[dry-run] (--prune) no kit-managed-skills snapshot yet; first real sync writes ${snapshot}, then future --prune runs reconcile against it`,
      );
    }
    return [];
  }

  const current = normalizeManifest(manifest);
  const currentBases = new Set(current.map(skillBase));
  let removed = 0;
  let failed = 0;
  const failedSlugs: Array<string> = [];
  for (const slug of readSlugs(snapshot)) {
    if (current.includes(slug)) continue;
    const base = skillBase(slug);
    if (currentBases.has(base)) continue;
    const canonical = p(ctx.agentsDir, "skills", base);
    // The skills CLI installs a canonical skill as a real directory that holds SKILL.md.
    const installedCanonical =
      lstat(canonical)?.isDirectory() === true && existsSync(p(canonical, "SKILL.md"));
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
      failedSlugs.push(slug);
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
        failedSlugs.push(slug);
        continue;
      }
    }
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
  return failedSlugs;
}

/**
 * Writes the declared slugs plus `retainedSlugs`. A slug leaves the snapshot
 * only after a successful --prune removes it.
 */
export function updateSnapshot(
  ctx: Ctx,
  manifest: string,
  snapshot: string,
  retainedSlugs: ReadonlyArray<string>,
): void {
  if (ctx.dryRun) return;

  mkdirSync(ctx.agentsDir, { recursive: true });
  const sorted = [...new Set([...normalizeManifest(manifest), ...retainedSlugs])].sort(
    compareCodepoints,
  );
  writeTextIfChanged(snapshot, sorted.length > 0 ? `${sorted.join("\n")}\n` : "");
}
