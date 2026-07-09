/**
 * EngineNative `sync agents` pipeline: universal-skill bootstrap
 * (`npx skills@<pin> add`), Claude symlink healing, --prune reconcile against
 * the kit-managed snapshot, agent-browser/effect-solutions toolchain callbacks,
 * and the snapshot write.
 */
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { capture, commandExists, isExecutable, p, which } from "./exec"
import { isLinux, isWindows } from "./os"
import type { Ctx } from "./index"
import { compareCodepoints } from "./jq"
import { change, echo, verbose, warn } from "./logger"
import { ensure, field } from "./toolchain"

export interface SkillsState {
  present: number
}

export function skillsSync(ctx: Ctx): SkillsState {
  const state: SkillsState = { present: 0 }
  const skillsDir = p(ctx.agentsDir, "skills")
  const manifest = p(ctx.repoDir, "SoT", ".agents", "skills.txt")
  const snapshot = p(ctx.agentsDir, ".kit-managed-skills")

  if (!existsSync(manifest)) return state

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
  if (!commandExists("node")) {
    warn("node/npx not in PATH — skipping universal skills bootstrap (install Node.js to enable)")
    return
  }

  let added = 0
  let already = 0
  let failed = 0
  let healed = 0

  for (const slug of readSlugs(manifest)) {
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
  } else {
    verbose(`Universal skills already in sync (${already} present)`)
  }
  if (healed > 0) {
    change(`Claude per-tool symlinks healed (+${healed}) — canonical present, ~/.claude/skills/<name> was missing or broken`)
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
  const canonical = p(skillsDir, base)
  const claudeSkillsDir = p(ctx.home, ".claude", "skills")
  const claudeLink = p(claudeSkillsDir, base)
  const relTarget = `../../.agents/skills/${base}`

  if (!isDir(canonical)) return false

  const linkStat = lstat(claudeLink)
  if (linkStat?.isSymbolicLink() === true) {
    const current = safeReadlink(claudeLink)
    if (current === relTarget) return false
    // win32: `npx skills add` creates absolute symlinks/junctions — any link
    // that RESOLVES to the canonical dir is healthy, not stale.
    if (isWindows() && realpathEquals(claudeLink, canonical)) return false
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
  return linkOrCopy(relTarget, claudeLink)
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

function realpathEquals(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b)
  } catch {
    return false
  }
}

/**
 * Remove a symlink/junction without crashing: Bun's rmSync throws EFAULT on
 * win32 directory symlinks. unlink handles file symlinks, rmdir handles
 * dir symlinks/junctions, rmSync is the POSIX catch-all.
 */
function removeLink(path: string): boolean {
  for (const rm of [() => unlinkSync(path), () => rmdirSync(path), () => rmSync(path, { force: true })]) {
    try {
      rm()
      return true
    } catch {
      // try the next removal shape
    }
  }
  return lstat(path) === undefined
}

/** skills::_link_or_copy — real symlink preferred, copy fallback (Windows). */
export function linkOrCopy(target: string, link: string): boolean {
  removeLink(link)
  try {
    symlinkSync(target, link, isWindows() ? "dir" : undefined)
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
  if (existsSync(link)) {
    warn(`symlinks unsupported here — ${link} is a copy (refreshed on sync; enable Windows Developer Mode for real links)`)
    return true
  }
  warn(`could not create ${link} (symlink and copy both failed)`)
  return false
}

// ------------------------------------------------- toolchain callbacks ----

/** skills::_agent_browser_install. */
export function agentBrowserInstall(mode: "install" | "upgrade", version: string): number {
  const verb = mode === "upgrade" ? "Upgrading" : "Installing"
  const pkg = version !== "" ? `agent-browser@${version}` : "agent-browser"
  const installFlags = isLinux() ? ["--with-deps"] : []

  change(`${verb} agent-browser CLI via npm${version !== "" ? ` (pinned ${version})` : ""}...`)
  if (spawnSync("npm", ["install", "-g", pkg], { stdio: "ignore" }).status !== 0) {
    warn(`npm install -g ${pkg} failed. Try manually: npm install -g ${pkg}`)
    return 1
  }

  if (mode === "install") {
    change("Downloading Chrome for Testing (~175 MB; sudo may be requested for system libs on Linux)...")
    if (spawnSync("agent-browser", ["install", ...installFlags], { stdio: "inherit" }).status !== 0) {
      warn(`agent-browser install failed. Re-run manually: agent-browser install ${installFlags.join(" ")}`)
      return 1
    }
  }
  const out = capture("agent-browser", ["--version"])
  const fields = (out.split("\n")[0] ?? "").trim().split(/[ \t]+/)
  const version2 = out !== "" ? fields[fields.length - 1] ?? "version unknown" : "version unknown"
  change(`agent-browser CLI ready (${version2})`)
  return 0
}

function syncAgentBrowserCli(ctx: Ctx, manifest: string): void {
  if (!existsSync(manifest) || !readFileSync(manifest, "utf8").split("\n").includes("vercel-labs/agent-browser")) return

  if (!commandExists("npm")) {
    if (!ctx.dryRun) warn("npm not found — cannot auto-install agent-browser CLI. Install Node.js, then re-run sync.")
    return
  }

  if (ensure(ctx, "agent-browser", agentBrowserInstall) !== 0) {
    warn("agent-browser bootstrap failed — continuing sync")
  }
}

/** skills::_find_bun — resolved bun path or "". */
function findBun(ctx: Ctx): string {
  const onPath = which("bun")
  if (onPath !== "") return onPath
  const bunInstall = process.env["BUN_INSTALL"] !== undefined && process.env["BUN_INSTALL"] !== "" ? process.env["BUN_INSTALL"] : p(ctx.home, ".bun")
  for (const cand of [p(bunInstall, "bin", "bun"), p(ctx.home, ".bun", "bin", "bun")]) {
    if (isExecutable(cand)) return cand
  }
  return ""
}

/** skills::_bun_bootstrap — bun path or "" after a failed bootstrap. */
export function bunBootstrap(ctx: Ctx): string {
  let bun = findBun(ctx)
  if (bun !== "") return bun

  if (!commandExists("curl")) {
    warn("Bun and curl both missing — cannot bootstrap Bun. Install Bun manually, then re-run sync.")
    return ""
  }
  const pin = field(ctx, "bun", "verified")
  warn(`Bun not found — installing Bun${pin !== "" ? ` ${pin} (kit-verified)` : ""}...`)
  const installer = p(tmpdir(), `bun-install-${process.pid}.sh`)
  const dl = spawnSync("curl", ["-fsSL", "https://bun.sh/install", "-o", installer], { stdio: "ignore" })
  if (dl.error === undefined && dl.status === 0) {
    spawnSync("bash", [installer, ...(pin !== "" ? [`bun-v${pin}`] : [])], { stdio: "ignore" })
  }
  rmSync(installer, { force: true })
  bun = findBun(ctx)
  if (bun === "") {
    warn("Bun install failed. Install manually: curl -fsSL https://bun.sh/install -o /tmp/bun.sh && bash /tmp/bun.sh")
    return ""
  }
  const v = capture(bun, ["--version"])
  change(`Bun installed (${v !== "" ? v : "version unknown"})`)
  return bun
}

/** skills::_effect_solutions_install. */
export function effectSolutionsInstall(ctx: Ctx): (mode: "install" | "upgrade", version: string) => number {
  return (mode, version) => {
    const verb = mode === "upgrade" ? "Upgrading" : "Installing"
    const pkg = `effect-solutions@${version !== "" ? version : "latest"}`

    const bun = bunBootstrap(ctx)
    if (bun === "") return 1

    change(`${verb} effect-solutions CLI via bun${version !== "" ? ` (pinned ${version})` : ""}...`)
    if (spawnSync(bun, ["add", "-g", pkg], { stdio: "ignore" }).status !== 0) {
      warn(`bun add -g ${pkg} failed. Try manually: bun add -g ${pkg}`)
      return 1
    }

    const gbin = capture(bun, ["pm", "-g", "bin"])
    // win32: bun writes an .exe shim (not the bare Unix name), and the
    // ~/.local/bin link step below is Unix-only plumbing (non-interactive
    // agent PATH) — bun's global bin is already the Windows PATH entry.
    if (isWindows()) {
      const found = gbin !== "" && ["exe", "cmd", "bunx"].some((ext) => existsSync(p(gbin, `effect-solutions.${ext}`)))
      if (found) change(`effect-solutions CLI ready (${gbin})`)
      else warn(`effect-solutions installed but no shim found under '${gbin !== "" ? gbin : "<unknown>"}' — check bun pm -g bin`)
      return 0
    }
    if (gbin !== "" && isExecutable(p(gbin, "effect-solutions"))) {
      mkdirSync(p(ctx.home, ".local", "bin"), { recursive: true })
      linkOrCopy(bun, p(ctx.home, ".local", "bin", "bun"))
      linkOrCopy(p(gbin, "effect-solutions"), p(ctx.home, ".local", "bin", "effect-solutions"))
      change("effect-solutions CLI ready (linked bun + effect-solutions into ~/.local/bin)")
    } else {
      warn(`effect-solutions installed but binary not found under '${gbin !== "" ? gbin : "<unknown>"}' — link it onto PATH manually`)
    }
    return 0
  }
}

function syncEffectSolutionsCli(ctx: Ctx): void {
  const settings = p(ctx.repoDir, "SoT", ".claude", "settings.json")
  if (!existsSync(settings)) return
  if (!/"effect-kit@docks"[ \t]*:[ \t]*true/.test(readFileSync(settings, "utf8"))) return

  if (ensure(ctx, "effect-solutions", effectSolutionsInstall(ctx)) !== 0) {
    warn("effect-solutions bootstrap failed — continuing sync")
  }
}

// ----------------------------------------------------- prune + snapshot ----

function reconcileRemovals(ctx: Ctx, manifest: string, snapshot: string): void {
  if (!existsSync(snapshot)) {
    if (ctx.dryRun) {
      echo(
        `[dry-run] (--prune) no kit-managed-skills snapshot yet; first real sync writes ${snapshot}, then future --prune runs reconcile against it`
      )
    }
    return
  }

  const current = readSlugs(manifest)
  let removed = 0
  let failed = 0
  for (const slug of readSlugs(snapshot)) {
    if (current.includes(slug)) continue
    const base = slug.slice(slug.lastIndexOf("/") + 1)
    if (ctx.dryRun) {
      echo(`[dry-run] kit-managed skill no longer in SoT — would remove: ${base}`)
      continue
    }
    const res = spawnSync("npx", ["--yes", skillsCli(ctx), "remove", "--global", "-y", "-a", "*", "-s", base], {
      stdio: "ignore"
    })
    if (res.error === undefined && res.status === 0) {
      removed++
    } else {
      warn(`Failed to remove kit-managed skill: ${base}`)
      failed++
    }
  }

  if (removed > 0) change(`Kit-managed skills removed (-${removed})`)
  if (failed > 0) warn(`${failed} skill remove(s) failed — re-run with --prune or run: npx skills remove -g -y -a '*' -s <name>`)
}

function updateSnapshot(ctx: Ctx, manifest: string, snapshot: string): void {
  if (ctx.dryRun) return

  mkdirSync(ctx.agentsDir, { recursive: true })
  const sorted = [...new Set(readSlugs(manifest))].sort(compareCodepoints)
  writeFileSync(snapshot, sorted.length > 0 ? `${sorted.join("\n")}\n` : "")
}

// -------------------------------------------------------------- summary ----

export function skillsSummary(ctx: Ctx, state: SkillsState): void {
  echo(`Skills:   ${p(ctx.agentsDir, "skills")}`)
  if (!ctx.dryRun) {
    echo(`          ${state.present} universal skill(s) installed`)
  }
}

export function skillsNextSteps(): void {
  echo("Restart Claude Code (and Codex) to discover newly installed universal skills.")
}
