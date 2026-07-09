/**
 * DependencyManager — one home for external-tool identity, presence probing,
 * and platform-correct install hints (Output Policy in DESIGN.md).
 *
 * Ownership split: SoT/toolchain.json + toolchain.ts keep version floors,
 * pin policy, and managed install/upgrade orchestration; this registry owns
 * WHICH external tools exist, whether they are required, and the one-line
 * command that installs a missing one.
 */
import { spawnSync } from "node:child_process"

import { commandExists } from "./exec"
import { warn } from "./logger"
import { rawPlatform } from "./os"

export type ToolId =
  | "git"
  | "jq"
  | "curl"
  | "node"
  | "npm"
  | "npx"
  | "claude"
  | "codex"
  | "rtk"
  | "bun"
  | "bwrap"
  | "agent-browser"
  | "effect-solutions"

/** required = the engine aborts when missing; optional = warn + degrade. */
export type Requirement = "required" | "optional"

export type ProbeResult =
  | { readonly state: "present"; readonly version: string }
  | { readonly state: "missing" }
  | { readonly state: "broken"; readonly reason: string }

export interface DependencySpec {
  readonly id: ToolId
  readonly requirement: Requirement
  readonly versionArgs: ReadonlyArray<string>
  /** Platform-correct one-line install command (param injectable for tests). */
  readonly installHint: (platform?: NodeJS.Platform) => string
}

const spec = (
  id: ToolId,
  requirement: Requirement,
  installHint: (platform?: NodeJS.Platform) => string,
  versionArgs: ReadonlyArray<string> = ["--version"]
): DependencySpec => ({ id, requirement, versionArgs, installHint })

export const DEPENDENCIES: Record<ToolId, DependencySpec> = {
  git: spec("git", "optional", (pf = rawPlatform()) =>
    pf === "win32"
      ? "winget install Git.Git (then open a new terminal)"
      : pf === "darwin"
        ? "brew install git"
        : "sudo apt install -y git (or your distro's package manager)"
  ),
  jq: spec("jq", "required", (pf = rawPlatform()) =>
    pf === "win32"
      ? "winget install jqlang.jq (then open a new terminal)"
      : pf === "darwin"
        ? "brew install jq"
        : "sudo apt install -y jq"
  ),
  curl: spec("curl", "required", (pf = rawPlatform()) =>
    pf === "win32" ? "winget install cURL.cURL" : pf === "darwin" ? "brew install curl" : "sudo apt install -y curl"
  ),
  node: spec("node", "optional", () => "install Node.js via https://nodejs.org (or your package manager)"),
  npm: spec("npm", "optional", () => "ships with Node.js — install via https://nodejs.org (or your package manager)"),
  npx: spec("npx", "optional", () => "ships with Node.js — install via https://nodejs.org (or your package manager)"),
  claude: spec("claude", "optional", (pf = rawPlatform()) =>
    pf === "win32"
      ? "winget install Anthropic.ClaudeCode"
      : "curl -fsSL https://claude.ai/install.sh -o /tmp/claude-install.sh && bash /tmp/claude-install.sh"
  ),
  codex: spec("codex", "optional", (pf = rawPlatform()) =>
    pf === "win32"
      ? `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"`
      : 'tmp=$(mktemp) && curl -fsSL https://chatgpt.com/codex/install.sh -o "$tmp" && CODEX_NON_INTERACTIVE=1 sh "$tmp"'
  ),
  rtk: spec("rtk", "optional", () => "see https://github.com/rtk-ai/rtk (kit auto-install is Unix-only)"),
  bun: spec("bun", "optional", (pf = rawPlatform()) =>
    pf === "win32" ? `powershell -c "irm bun.sh/install.ps1 | iex"` : "curl -fsSL https://bun.sh/install | bash"
  ),
  bwrap: spec("bwrap", "optional", () => "sudo apt install -y bubblewrap (or dnf/pacman/zypper equivalent)"),
  "agent-browser": spec("agent-browser", "optional", () => "npm install -g agent-browser"),
  "effect-solutions": spec("effect-solutions", "optional", () => "bun add -g effect-solutions")
}

export function probe(id: ToolId): ProbeResult {
  const s = DEPENDENCIES[id]
  if (!commandExists(id)) return { state: "missing" }
  const res = spawnSync(id, [...s.versionArgs], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  if (res.error !== undefined || res.status !== 0) {
    return { state: "broken", reason: `${id} ${s.versionArgs.join(" ")} exited ${res.status ?? "spawn-error"}` }
  }
  return { state: "present", version: (res.stdout ?? "").replace(/[\r\n]+$/, "") }
}

// One deduplicated warn per missing tool per run (Output Policy): the first
// caller's context wins; later pipelines still degrade but stay quiet.
const warned = new Set<ToolId>()

/** Uniform missing-tool warn: `<tool> not installed — <install command>`. */
export function warnMissing(id: ToolId, context = "", pf?: NodeJS.Platform): void {
  if (warned.has(id)) return
  warned.add(id)
  const suffix = context !== "" ? ` (${context})` : ""
  warn(`${id} not installed — ${DEPENDENCIES[id].installHint(pf)}${suffix}`)
}
