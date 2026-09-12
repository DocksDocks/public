/**
 * EngineNative skill link mechanics: Claude per-tool symlink healing plus the
 * directory-link-or-marked-copy fallback. Split from skillsSync.ts; the
 * install pass (skillsInstall.ts) and the prune pass (skillsPrune.ts) share
 * the probe and removal helpers exported here.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { p } from "./exec"
import type { Ctx } from "./index"
import { hostOs, type DirectoryLinkKind } from "./os"
import type { EngineServices } from "./services"

export type LinkOutcome = "symlink" | "junction" | "copy" | "failed"

/** Lets heal and prune distinguish a kit-owned copy from a user's real directory. */
export const COPY_MARKER = ".docks-kit-copied-skill"

export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** skills::heal_claude_symlink — true when a heal occurred. */
export function healClaudeSymlink(ctx: Ctx, skillsDir: string, base: string): boolean {
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

export function lstat(path: string): ReturnType<typeof lstatSync> | undefined {
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

export function isKitOwnedCopy(path: string): boolean {
  return lstat(path)?.isDirectory() === true && existsSync(p(path, COPY_MARKER))
}

export function removeKitOwnedCopy(path: string): boolean {
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
export function removeLink(path: string): boolean {
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
