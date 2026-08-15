/**
 * EngineNative `sync agents` pipeline: universal-skill bootstrap
 * (`npx skills@<pin> add`), Claude symlink healing, --prune reconcile against
 * the kit-managed snapshot, and the snapshot write.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { payloadText } from "../payload"
import { p, spawnProcess, writeFileIfChanged } from "./exec"
import type { Ctx } from "./index"
import { compareCodepoints } from "./jq"
import { hostOs, type DirectoryLinkKind } from "./os"
import { ExitError } from "./parseArgs"
import type { EngineServices } from "./services"
import { field } from "./toolchain"

export interface SkillsState {
  present: number
}

export type LinkOutcome = "symlink" | "junction" | "copy" | "failed"

/** Lets heal and prune distinguish a kit-owned copy from a user's real directory. */
export const COPY_MARKER = ".docks-kit-copied-skill"

export async function skillsSync(ctx: Ctx): Promise<SkillsState> {
  const state: SkillsState = { present: 0 }
  const skillsDir = p(ctx.agentsDir, "skills")
  const manifest = payloadText("SoT/.agents/skills.txt")
  const snapshot = p(ctx.agentsDir, ".kit-managed-skills")

  if (!ctx.dryRun) mkdirSync(skillsDir, { recursive: true })

  await syncUniversal(ctx, state, skillsDir, manifest)
  const failedRemovals = ctx.prune ? await reconcileRemovals(ctx, manifest, snapshot) : []
  updateSnapshot(ctx, manifest, snapshot, failedRemovals)
  return state
}

/** skills::_skills_cli — the pinned npx package spec. */
function skillsCli(ctx: Ctx): string {
  const version = field(ctx, "skills-cli", "verified")
  if (version !== "") return `skills@${version}`
  ctx.services.logger.err("Universal skills sync aborted because SoT/toolchain.json has no verified skills-cli pin")
  throw new ExitError(1)
}

/** skills::_normalize_manifest — cleaned slugs, one per line. */
export function normalizeManifest(content: string): Array<string> {
  const out: Array<string> = []
  for (const line of content.split("\n")) {
    if (/^[ \t]*#/.test(line)) continue
    if (/^[ \t]*$/.test(line)) continue
    const cleaned = line.replace(/[ \t]*#.*$/, "").replace(/[ \t\r]+/g, "")
    if (cleaned.length > 0) out.push(cleaned)
  }
  return out
}

function readSlugs(file: string): Array<string> {
  return existsSync(file) ? normalizeManifest(readFileSync(file, "utf8")) : []
}

async function syncUniversal(ctx: Ctx, state: SkillsState, skillsDir: string, manifest: string): Promise<void> {
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

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** skills::heal_claude_symlink — true when a heal occurred. */
function healClaudeSymlink(ctx: Ctx, skillsDir: string, base: string): boolean {
  const { echo, warn } = ctx.services.logger
  const canonical = p(skillsDir, base)
  const claudeSkillsDir = p(ctx.home, ".claude", "skills")
  const claudeLink = p(claudeSkillsDir, base)
  const relTarget = relative(dirname(claudeLink), canonical)

  if (!isDir(canonical)) return false

  const linkStat = lstat(claudeLink)
  if (linkStat?.isSymbolicLink() === true) {
    const current = safeReadlink(claudeLink)
    if (current === relTarget) return false
    if (ctx.dryRun) {
      echo(`[dry-run] would replace stale Claude symlink: ~/.claude/skills/${base} -> ${current}  (correct: ${relTarget})`)
      return true
    }
    if (!removeLink(claudeLink)) {
      warn(`could not remove stale link ~/.claude/skills/${base} — remove it manually, then re-run sync`)
      return false
    }
  } else if (linkStat !== undefined) {
    if (!isKitOwnedCopy(claudeLink)) {
      warn(`~/.claude/skills/${base} exists as a real path (not a symlink) — leaving alone; remove manually if it's stale`)
      return false
    }
    if (ctx.dryRun) {
      echo(`[dry-run] would replace kit-created Claude copy: ~/.claude/skills/${base} -> ${relTarget}`)
      return true
    }
    if (!removeKitOwnedCopy(claudeLink)) {
      warn(`could not remove kit-created copy ~/.claude/skills/${base} — remove it manually, then re-run sync`)
      return false
    }
  } else if (ctx.dryRun) {
    echo(`[dry-run] would create missing Claude symlink: ~/.claude/skills/${base} -> ${relTarget}`)
    return true
  }

  mkdirSync(claudeSkillsDir, { recursive: true })
  return linkOrCopyWithWarnings(relTarget, claudeLink, ctx.services) !== "failed"
}

function lstat(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

/**
 * A link only counts when it RESOLVES to the skill directory. Windows picks a
 * symlink's file-or-directory type by autodetecting the target against the
 * process working directory, not the link's own directory, so a relative
 * target can yield a symlink that exists but resolves to nothing. Checking
 * resolution is what makes the next mechanism in the chain reachable.
 */
function linksToDirectory(path: string): boolean {
  if (lstat(path)?.isSymbolicLink() !== true) return false
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isKitOwnedCopy(path: string): boolean {
  return lstat(path)?.isDirectory() === true && existsSync(p(path, COPY_MARKER))
}

function removeKitOwnedCopy(path: string): boolean {
  if (!isKitOwnedCopy(path)) return false
  try {
    rmSync(path, { recursive: true, force: true })
    return true
  } catch {
    return lstat(path) === undefined
  }
}

function safeReadlink(path: string): string {
  try {
    return readlinkSync(path)
  } catch {
    return ""
  }
}


/** Remove a symlink without touching a real directory. */
function removeLink(path: string): boolean {
  try {
    rmSync(path, { force: true })
    return true
  } catch {
    return lstat(path) === undefined
  }
}

/** skills::_link_or_copy — try directory links in host order, then a marked copy. */
export function linkOrCopy(
  target: string,
  link: string,
  kinds: ReadonlyArray<DirectoryLinkKind> = hostOs().directoryLinkKinds
): LinkOutcome {
  const resolvedLink = resolve(link)
  const absoluteTarget = resolve(dirname(resolvedLink), target)
  if (absoluteTarget === resolvedLink) return "symlink"
  removeLink(link)

  for (const kind of kinds) {
    try {
      if (kind === "symlink") {
        symlinkSync(target, link)
      } else {
        symlinkSync(absoluteTarget, link, "junction")
      }
      if (linksToDirectory(link)) return kind
    } catch {
      // The runtime decides whether each mechanism works; try the next one.
    }
    removeLink(link)
  }

  const copyDestinationWasAbsent = lstat(link) === undefined
  try {
    cpSync(absoluteTarget, link, { recursive: true })
    writeFileSync(p(link, COPY_MARKER), "")
    return "copy"
  } catch {
    if (copyDestinationWasAbsent) {
      try {
        rmSync(link, { recursive: true, force: true })
      } catch {
        // The outcome remains failed; a later sync can retry the destination.
      }
    }
    return "failed"
  }
}

function linkOrCopyWithWarnings(target: string, link: string, services: EngineServices): LinkOutcome {
  const outcome = linkOrCopy(target, link)
  if (outcome === "copy") {
    services.logger.warn(`created copy fallback ${link} because directory linking is unavailable — a later sync will restore a real link once linking works`)
  } else if (outcome === "failed") {
    services.logger.warn(`could not create symlink ${link}`)
  }
  return outcome
}

// ----------------------------------------------------- prune + snapshot ----

async function reconcileRemovals(ctx: Ctx, manifest: string, snapshot: string): Promise<Array<string>> {
  const { change, clearProgress, echo, progress, warn } = ctx.services.logger
  if (!existsSync(snapshot)) {
    if (ctx.dryRun) {
      echo(
        `[dry-run] (--prune) no kit-managed-skills snapshot yet; first real sync writes ${snapshot}, then future --prune runs reconcile against it`
      )
    }
    return []
  }

  const current = normalizeManifest(manifest)
  const currentBases = new Set(current.map((slug) => slug.slice(slug.lastIndexOf("/") + 1)))
  let removed = 0
  let failed = 0
  const failedSlugs: Array<string> = []
  for (const slug of readSlugs(snapshot)) {
    if (current.includes(slug)) continue
    const base = slug.slice(slug.lastIndexOf("/") + 1)
    if (currentBases.has(base)) continue
    const claudeEntry = p(ctx.home, ".claude", "skills", base)
    const managedClaudeEntry = lstat(claudeEntry)?.isSymbolicLink() === true || isKitOwnedCopy(claudeEntry)
    if (ctx.dryRun) {
      echo(`[dry-run] kit-managed skill no longer in SoT — would remove: ${base}`)
      if (managedClaudeEntry) {
        echo(`[dry-run] kit-managed Claude skill entry — would remove: ~/.claude/skills/${base}`)
      }
      continue
    }
    progress(`Removing universal skill ${base}...`)
    const res = await spawnProcess("npx", ["--yes", skillsCli(ctx), "remove", "--global", base, "-y"], {
      stdio: "ignore"
    })
    clearProgress()
    if (res.error !== undefined || res.exitCode !== 0) {
      warn(`Failed to remove kit-managed skill: ${base}`)
      failed++
      failedSlugs.push(slug)
      continue
    }
    if (managedClaudeEntry) {
      const entryStat = lstat(claudeEntry)
      const removedClaudeEntry = entryStat === undefined
        || (entryStat.isSymbolicLink() ? removeLink(claudeEntry) : removeKitOwnedCopy(claudeEntry))
      if (!removedClaudeEntry) {
        warn(`Failed to remove kit-managed Claude skill entry: ${base}`)
        failed++
        failedSlugs.push(slug)
        continue
      }
    }
    removed++
  }

  if (removed > 0) {
    change(`Kit-managed skills removed (-${removed})`)
    ctx.nextStepTriggers.skillsRestart = true
  }
  if (failed > 0) warn(`${failed} skill remove(s) failed — re-run with --prune or run: npx skills remove --global <name> -y`)
  return failedSlugs
}

function updateSnapshot(ctx: Ctx, manifest: string, snapshot: string, failedRemovals: ReadonlyArray<string>): void {
  if (ctx.dryRun) return

  mkdirSync(ctx.agentsDir, { recursive: true })
  const sorted = [...new Set([...normalizeManifest(manifest), ...failedRemovals])].sort(compareCodepoints)
  writeFileIfChanged(snapshot, sorted.length > 0 ? `${sorted.join("\n")}\n` : "")
}

// -------------------------------------------------------------- summary ----

export function skillsSummary(ctx: Ctx, state: SkillsState): void {
  const { echo } = ctx.services.logger
  echo(`Skills:   ${p(ctx.agentsDir, "skills")}`)
  if (!ctx.dryRun) {
    echo(`          ${state.present} universal skill(s) installed`)
  }
}

export function skillsNextSteps(ctx: Ctx): Array<string> {
  return ctx.verbose || ctx.nextStepTriggers.skillsRestart
    ? ["Restart Claude Code (and Codex) to discover newly installed universal skills."]
    : []
}
