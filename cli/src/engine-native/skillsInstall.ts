/**
 * EngineNative universal-skill install pass (`npx skills@<pin> add`) with
 * Claude symlink healing. Split from skillsSync.ts; the orchestration still
 * lives there. The pass records a slug as pending before its install only
 * when the canonical directory does not exist (`skillsRecords.ts`). After
 * the install, it moves the slug to the owned record when its directory
 * exists. It writes both records before the next install starts. A canonical
 * directory that existed before is reused and never recorded.
 */
import { p, spawnProcess } from "./exec";
import type { Ctx } from "./index";
import { ExitError } from "./parseArgs";
import { healClaudeSymlink, isDir } from "./skillsLinks";
import {
  canonicalAbsent,
  recordPendingInstall,
  settlePendingSlug,
  writeSkillRecords,
  type SkillRecords,
} from "./skillsRecords";
import { normalizeManifest, skillBase } from "./skillsManifest";
import { field } from "./toolchain";

export interface SkillsState {
  present: number;
}

/** skills::_skills_cli — the pinned npx package spec. */
function skillsCli(ctx: Ctx): string {
  const version = field("skills-cli", "verified");
  if (version !== "") return `skills@${version}`;
  ctx.services.logger.err(
    "Universal skills sync aborted because SoT/toolchain.json has no verified skills-cli pin",
  );
  throw new ExitError(1);
}

export async function syncUniversal(
  ctx: Ctx,
  state: SkillsState,
  skillsDir: string,
  manifest: string,
  records: SkillRecords,
): Promise<void> {
  const { change, clearProgress, echo, progress, verbose, warn } = ctx.services.logger;
  if (ctx.services.deps.probe("npx").state === "missing") {
    ctx.services.deps.warnMissing(
      "npx",
      ctx.services.logger,
      "skipping universal skills bootstrap",
    );
    return;
  }

  let added = 0;
  let already = 0;
  let failed = 0;
  let healed = 0;

  for (const slug of normalizeManifest(manifest)) {
    const base = skillBase(slug);

    if (ctx.dryRun) {
      if (isDir(p(skillsDir, base))) {
        echo(`[dry-run] universal skill present: ${base}`);
        healClaudeSymlink(ctx, skillsDir, base);
      } else {
        echo(`[dry-run] npx ${skillsCli(ctx)} add ${slug} -g -y -a claude-code codex`);
      }
      continue;
    }

    if (isDir(p(skillsDir, base))) {
      already++;
      if (!records.owned.has(slug) && !records.legacy.has(slug)) {
        warn(
          `Universal skill ${slug}: reused the existing ~/.agents/skills/${base}; the kit did not install it, so --prune keeps it`,
        );
      }
      if (healClaudeSymlink(ctx, skillsDir, base)) healed++;
      continue;
    }

    const cli = skillsCli(ctx);
    const pending = canonicalAbsent(skillsDir, slug);
    if (pending) recordPendingInstall(records, slug);
    progress(`Installing universal skill ${slug}...`);
    const res = await spawnProcess(
      "npx",
      ["--yes", cli, "add", slug, "-g", "-y", "-a", "claude-code", "codex"],
      {
        stdio: "ignore",
      },
    );
    clearProgress();
    if (pending) {
      // The owned record goes first, so a stop between the writes keeps the slug pending.
      settlePendingSlug(records, skillsDir, slug);
      writeSkillRecords(ctx, records);
    }
    if (res.error === undefined && res.exitCode === 0) {
      added++;
      if (!isDir(p(skillsDir, base))) {
        warn(
          `Installed skill name differs from slug ${slug}; declare it as <owner>/<repo>@<skill-name>`,
        );
      }
    } else {
      warn(`Failed to install universal skill: ${slug}`);
      failed++;
    }
  }

  if (ctx.dryRun) return;

  state.present = added + already;

  if (added > 0) {
    change(`Universal skills synced (+${added} new, ${already} already present)`);
    ctx.nextStepTriggers.skillsRestart = true;
  } else {
    verbose(`Universal skills already in sync (${already} present)`);
  }
  if (healed > 0) {
    change(
      `Claude per-tool symlinks healed (+${healed}) — canonical present, ~/.claude/skills/<name> was missing or broken`,
    );
    ctx.nextStepTriggers.skillsRestart = true;
  }
  if (failed > 0) {
    warn(
      `${failed} skill install(s) failed — re-run sync or install manually with: npx --yes ${skillsCli(ctx)} add <slug> -g -y -a claude-code codex`,
    );
  }
}
