/**
 * EngineNative `sync agents` pipeline: universal-skill bootstrap
 * (`npx skills@<pin> add`), Claude symlink healing, --prune reconcile against
 * the kit-managed snapshot, agent-browser/effect-solutions toolchain callbacks,
 * and the snapshot write.
 */
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync } from "node:fs"
import { p, writeFileIfChanged } from "./exec"
import { bunBootstrap } from "./bun"
import type { Ctx } from "./index"
import { compareCodepoints } from "./jq"
import type { EngineServices } from "./services"
import { ensure, field } from "./toolchain"
import { payloadText } from "../payload"

export interface SkillsState {
  present: number
}

export function skillsSync(ctx: Ctx): SkillsState {
  const state: SkillsState = { present: 0 }
  const skillsDir = p(ctx.agentsDir, "skills")
  const manifest = payloadText("SoT/.agents/skills.txt")
  const snapshot = p(ctx.agentsDir, ".kit-managed-skills")

  if (!ctx.dryRun) mkdirSync(skillsDir, { recursive: true })

  syncUniversal(ctx, state, skillsDir, manifest)
  if (ctx.prune) reconcileRemovals(ctx, manifest, snapshot)
  syncAgentBrowserCli(ctx, manifest)
  syncEffectSolutionsCli(ctx)
  updateSnapshot(ctx, manifest, snapshot)
  return state
}

/** skills::_skills_cli — the pinned npx package spec. */
function skillsCli(ctx: Ctx): string {
  const v = field(ctx, "skills-cli", "verified")
  return v !== "" ? `skills@${v}` : "skills"
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

function syncUniversal(ctx: Ctx, state: SkillsState, skillsDir: string, manifest: string): void {
  const { change, echo, verbose, warn } = ctx.services.logger
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

    const res = spawnSync("npx", ["--yes", skillsCli(ctx), "add", slug, "-g", "-y", "-a", "claude-code", "codex"], {
      stdio: "ignore"
    })
    if (res.error === undefined && res.status === 0) {
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
  const relTarget = `../../.agents/skills/${base}`

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
    warn(`~/.claude/skills/${base} exists as a real path (not a symlink) — leaving alone; remove manually if it's stale`)
    return false
  } else if (ctx.dryRun) {
    echo(`[dry-run] would create missing Claude symlink: ~/.claude/skills/${base} -> ${relTarget}`)
    return true
  }

  mkdirSync(claudeSkillsDir, { recursive: true })
  return linkOrCopyWithWarnings(relTarget, claudeLink, ctx.services)
}

function lstat(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path)
  } catch {
    return undefined
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

/** skills::_link_or_copy — real symlink preferred, copy fallback. */
export function linkOrCopy(target: string, link: string): boolean {
  removeLink(link)
  try {
    symlinkSync(target, link)
  } catch {
    // fall through to the copy fallback below
  }
  if (lstat(link)?.isSymbolicLink() === true) return true
  try {
    // Resolve a relative target against the link's parent, like ln does.
    const resolved = target.startsWith("/") ? target : p(link.slice(0, link.lastIndexOf("/")), target)
    cpSync(resolved, link, { recursive: true })
  } catch {
    // fall through to the existence check below
  }
  return existsSync(link)
}

function linkOrCopyWithWarnings(target: string, link: string, services: EngineServices): boolean {
  const linked = linkOrCopy(target, link)
  if (!linked) {
    services.logger.warn(`could not create ${link} (symlink and copy both failed)`)
  } else if (lstat(link)?.isSymbolicLink() !== true) {
    services.logger.warn(`symlinks unsupported here — ${link} is a copy refreshed on sync`)
  }
  return linked
}

// ------------------------------------------------- toolchain callbacks ----

/** skills::_agent_browser_install. */
export function agentBrowserInstall(mode: "install" | "upgrade", version: string, services: EngineServices): number {
  const { change, verbose, warn } = services.logger
  const verb = mode === "upgrade" ? "Upgrading" : "Installing"
  const pkg = version !== "" ? `agent-browser@${version}` : "agent-browser"
  const installFlags = services.platform.isLinux() ? ["--with-deps"] : []

  verbose(`${verb} agent-browser CLI via npm${version !== "" ? ` (pinned ${version})` : ""}...`)
  if (spawnSync("npm", ["install", "-g", pkg], { stdio: "ignore" }).status !== 0) {
    warn(`npm install -g ${pkg} failed. Try manually: npm install -g ${pkg}`)
    return 1
  }

  if (mode === "install") {
    warn("Downloading Chrome for Testing (~175 MB; sudo may be requested for system libs on Linux)...")
    if (spawnSync("agent-browser", ["install", ...installFlags], { stdio: "inherit" }).status !== 0) {
      warn(`agent-browser install failed. Re-run manually: agent-browser install ${installFlags.join(" ")}`)
      return 1
    }
  }
  const out = services.deps.version("agent-browser")
  const fields = (out.split("\n")[0] ?? "").trim().split(/[ \t]+/)
  const version2 = out !== "" ? fields[fields.length - 1] ?? "version unknown" : "version unknown"
  change(`agent-browser CLI ready (${version2})`)
  return 0
}

function syncAgentBrowserCli(ctx: Ctx, manifest: string): void {
  const { warn } = ctx.services.logger
  if (!manifest.split("\n").includes("vercel-labs/agent-browser")) return

  if (ctx.services.deps.probe("npm").state === "missing") {
    if (!ctx.dryRun) {
      ctx.services.deps.warnMissing("npm", ctx.services.logger, "cannot auto-install agent-browser CLI; re-run sync after installing")
    }
    return
  }

  if (ensure(ctx, "agent-browser", agentBrowserInstall) !== 0) {
    warn("agent-browser bootstrap failed — continuing sync")
  }
}

/** skills::_effect_solutions_install. */
export function effectSolutionsInstall(
  ctx: Ctx
): (mode: "install" | "upgrade", version: string, services: EngineServices) => number {
  return (mode, version, services) => {
    const { change, verbose, warn } = services.logger
    const verb = mode === "upgrade" ? "Upgrading" : "Installing"
    const pkg = `effect-solutions@${version !== "" ? version : "latest"}`

    const bunState = bunBootstrap(ctx, services)
    if (bunState.kind === "deferred") return 1
    const bun = bunState.executable

    verbose(`${verb} effect-solutions CLI via bun${version !== "" ? ` (pinned ${version})` : ""}...`)
    if (spawnSync(bun, ["add", "-g", pkg], { stdio: "ignore" }).status !== 0) {
      warn(`bun add -g ${pkg} failed. Try manually: bun add -g ${pkg}`)
      return 1
    }

    const location = services.deps.location("effect-solutions")
    const gbin = location.binDir
    if (location.path !== "") {
      mkdirSync(p(ctx.home, ".local", "bin"), { recursive: true })
      linkOrCopyWithWarnings(bun, p(ctx.home, ".local", "bin", "bun"), services)
      linkOrCopyWithWarnings(location.path, p(ctx.home, ".local", "bin", "effect-solutions"), services)
      change("effect-solutions CLI ready (linked bun + effect-solutions into ~/.local/bin)")
    } else {
      warn(`effect-solutions installed but binary not found under '${gbin !== "" ? gbin : "<unknown>"}' — link it onto PATH manually`)
    }
    return 0
  }
}

function syncEffectSolutionsCli(ctx: Ctx): void {
  const { warn } = ctx.services.logger
  if (!/"effect-kit@docks"[ \t]*:[ \t]*true/.test(payloadText("SoT/.claude/settings.json"))) return

  if (ensure(ctx, "effect-solutions", effectSolutionsInstall(ctx)) !== 0) {
    warn("effect-solutions bootstrap failed — continuing sync")
  }
}

// ----------------------------------------------------- prune + snapshot ----

function reconcileRemovals(ctx: Ctx, manifest: string, snapshot: string): void {
  const { change, echo, warn } = ctx.services.logger
  if (!existsSync(snapshot)) {
    if (ctx.dryRun) {
      echo(
        `[dry-run] (--prune) no kit-managed-skills snapshot yet; first real sync writes ${snapshot}, then future --prune runs reconcile against it`
      )
    }
    return
  }

  const current = normalizeManifest(manifest)
  let removed = 0
  let failed = 0
  for (const slug of readSlugs(snapshot)) {
    if (current.includes(slug)) continue
    const base = slug.slice(slug.lastIndexOf("/") + 1)
    if (ctx.dryRun) {
      echo(`[dry-run] kit-managed skill no longer in SoT — would remove: ${base}`)
      continue
    }
    const res = spawnSync("npx", ["--yes", skillsCli(ctx), "remove", "--global", base, "-y"], {
      stdio: "ignore"
    })
    if (res.error === undefined && res.status === 0) {
      removed++
    } else {
      warn(`Failed to remove kit-managed skill: ${base}`)
      failed++
    }
  }

  if (removed > 0) {
    change(`Kit-managed skills removed (-${removed})`)
    ctx.nextStepTriggers.skillsRestart = true
  }
  if (failed > 0) warn(`${failed} skill remove(s) failed — re-run with --prune or run: npx skills remove --global <name> -y`)
}

function updateSnapshot(ctx: Ctx, manifest: string, snapshot: string): void {
  if (ctx.dryRun) return

  mkdirSync(ctx.agentsDir, { recursive: true })
  const sorted = [...new Set(normalizeManifest(manifest))].sort(compareCodepoints)
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
