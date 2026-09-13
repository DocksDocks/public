/**
 * EngineNative kit-managed skill prune (`--prune` reconcile against the
 * snapshot) and snapshot write. Split from skillsSync.ts; the orchestration
 * still lives there.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { p, spawnProcess, writeTextIfChanged } from "./exec";
import type { Ctx } from "./index";
import { compareCodepoints } from "./jq";
import { skillsCli } from "./skillsInstall";
import { isKitOwnedCopy, lstat, removeKitOwnedCopy, removeLink } from "./skillsLinks";
import { normalizeManifest } from "./skillsManifest";

// ----------------------------------------------------- prune + snapshot ----

function readSlugs(file: string): Array<string> {
  return existsSync(file) ? normalizeManifest(readFileSync(file, "utf8")) : [];
}

export async function reconcileRemovals(
  ctx: Ctx,
  manifest: string,
  snapshot: string,
): Promise<Array<string>> {
  const { change, clearProgress, echo, progress, warn } = ctx.services.logger;
  if (!existsSync(snapshot)) {
    if (ctx.dryRun) {
      echo(
        `[dry-run] (--prune) no kit-managed-skills snapshot yet; first real sync writes ${snapshot}, then future --prune runs reconcile against it`,
      );
    }
    return [];
  }

  const current = normalizeManifest(manifest);
  const currentBases = new Set(current.map((slug) => slug.slice(slug.lastIndexOf("/") + 1)));
  let removed = 0;
  let failed = 0;
  const failedSlugs: Array<string> = [];
  for (const slug of readSlugs(snapshot)) {
    if (current.includes(slug)) continue;
    const base = slug.slice(slug.lastIndexOf("/") + 1);
    if (currentBases.has(base)) continue;
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
    progress(`Removing universal skill ${base}...`);
    const res = await spawnProcess(
      "npx",
      ["--yes", skillsCli(ctx), "remove", "--global", base, "-y"],
      {
        stdio: "ignore",
      },
    );
    clearProgress();
    if (res.error !== undefined || res.exitCode !== 0) {
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
      `${failed} skill remove(s) failed — re-run with --prune or run: npx skills remove --global <name> -y`,
    );
  return failedSlugs;
}

export function updateSnapshot(
  ctx: Ctx,
  manifest: string,
  snapshot: string,
  failedRemovals: ReadonlyArray<string>,
): void {
  if (ctx.dryRun) return;

  mkdirSync(ctx.agentsDir, { recursive: true });
  const sorted = [...new Set([...normalizeManifest(manifest), ...failedRemovals])].sort(
    compareCodepoints,
  );
  writeTextIfChanged(snapshot, sorted.length > 0 ? `${sorted.join("\n")}\n` : "");
}
