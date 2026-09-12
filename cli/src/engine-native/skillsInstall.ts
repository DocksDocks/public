/**
 * EngineNative universal-skill install pass (`npx skills@<pin> add`) with
 * Claude symlink healing. Split from skillsSync.ts; the orchestration still
 * lives there. The prune pass (skillsPrune.ts) shares `skillsCli`.
 */
import { p, spawnProcess } from "./exec"
import type { Ctx } from "./index"
import { ExitError } from "./parseArgs"
import { healClaudeSymlink, isDir } from "./skillsLinks"
import { normalizeManifest } from "./skillsManifest"
import { field } from "./toolchain"

export interface SkillsState {
  present: number
}

/** skills::_skills_cli — the pinned npx package spec. */
export function skillsCli(ctx: Ctx): string {
  const version = field("skills-cli", "verified")
  if (version !== "") return `skills@${version}`
  ctx.services.logger.err("Universal skills sync aborted because SoT/toolchain.json has no verified skills-cli pin")
  throw new ExitError(1)
}

export async function syncUniversal(ctx: Ctx, state: SkillsState, skillsDir: string, manifest: string): Promise<void> {
  const { change, clearProgress, echo, progress, verbose, warn } = ctx.services.logger
  if (ctx.services.deps.probe("npx").state === "missing") {
    ctx.services.deps.warnMissing("npx", ctx.services.logger, "skipping universal skills bootstrap")
    return
  }

  let added = 0
  let already = 0
  let failed = 0
  let healed = 0

  for (const slug of normalizeManifest(manifest)) {
    const base = slug.slice(slug.lastIndexOf("/") + 1)

    if (ctx.dryRun) {
      if (isDir(p(skillsDir, base))) {
        echo(`[dry-run] universal skill present: ${base}`)
        healClaudeSymlink(ctx, skillsDir, base)
      } else {
        echo(`[dry-run] npx ${skillsCli(ctx)} add ${slug} -g -y -a claude-code codex`)
      }
      continue
    }

    if (isDir(p(skillsDir, base))) {
      already++
      if (healClaudeSymlink(ctx, skillsDir, base)) healed++
      continue
    }

    progress(`Installing universal skill ${slug}...`)
    const res = await spawnProcess("npx", ["--yes", skillsCli(ctx), "add", slug, "-g", "-y", "-a", "claude-code", "codex"], {
      stdio: "ignore"
    })
    clearProgress()
    if (res.error === undefined && res.exitCode === 0) {
      added++
    } else {
      warn(`Failed to install universal skill: ${slug}`)
      failed++
    }
  }

  if (ctx.dryRun) return

  state.present = added + already

  if (added > 0) {
    change(`Universal skills synced (+${added} new, ${already} already present)`)
    ctx.nextStepTriggers.skillsRestart = true
  } else {
    verbose(`Universal skills already in sync (${already} present)`)
  }
  if (healed > 0) {
    change(`Claude per-tool symlinks healed (+${healed}) — canonical present, ~/.claude/skills/<name> was missing or broken`)
    ctx.nextStepTriggers.skillsRestart = true
  }
  if (failed > 0) {
    warn(`${failed} skill install(s) failed — re-run sync or install manually with: npx skills add <slug> -g -y -a claude-code codex`)
  }
}
