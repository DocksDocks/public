/**
 * DependencyManager — one home for external-tool identity, presence probing,
 * and platform-correct install hints (Output Policy in DESIGN.md).
 *
 * Ownership split: SoT/toolchain.json + toolchain.ts keep version floors,
 * pin policy, and managed install/upgrade orchestration; this registry owns
 * WHICH external tools exist, whether they are required, and the one-line
 * command that installs a missing one.
 */
import { homedir } from "node:os"
import { isAbsolute } from "node:path"
import { existsSync, readdirSync } from "node:fs"

import { capture, commandExists, p, which } from "./exec"
import { isObject, parseJson } from "./jq"
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
  | "session-relay"
  | "chrome-for-testing"
  | "ffplay"
  | "intelephense"
  | "typescript-language-server"
  | "tsc"
  | "apt-get"
  | "dnf"
  | "pacman"
  | "zypper"

/** required = the engine aborts when missing; optional = warn + degrade. */
export type Requirement = "required" | "optional"

export type ProbeResult =
  | { readonly state: "present"; readonly path?: string }
  | { readonly state: "missing" }

export interface DependencyLocation {
  readonly path: string
  readonly binDir: string
}

export interface ProbeExecutor {
  readonly commandExists: (name: string) => boolean
  readonly capture: (cmd: string, args: ReadonlyArray<string>) => string
  readonly which: (name: string) => string
}

export interface DependencySpec {
  readonly id: ToolId
  readonly requirement: Requirement
  readonly versionArgs: ReadonlyArray<string>
  /** Platform-correct one-line install command (param injectable for tests). */
  readonly installHint: (platform?: NodeJS.Platform) => string
  readonly resolve?: (exec: ProbeExecutor, platform: NodeJS.Platform) => ProbeResult
  readonly version?: (exec: ProbeExecutor) => string
  readonly locate?: (exec: ProbeExecutor, platform: NodeJS.Platform) => DependencyLocation
  readonly latest?: (exec: ProbeExecutor) => string
}

interface SpecOptions {
  readonly versionArgs?: ReadonlyArray<string>
  readonly resolve?: (exec: ProbeExecutor, platform: NodeJS.Platform) => ProbeResult
  readonly version?: (exec: ProbeExecutor) => string
  readonly locate?: (exec: ProbeExecutor, platform: NodeJS.Platform) => DependencyLocation
  readonly latest?: (exec: ProbeExecutor) => string
}

const spec = (
  id: ToolId,
  requirement: Requirement,
  installHint: (platform?: NodeJS.Platform) => string,
  options: SpecOptions = {}
): DependencySpec => ({
  id,
  requirement,
  versionArgs: options.versionArgs ?? ["--version"],
  installHint,
  resolve: options.resolve,
  version: options.version,
  locate: options.locate,
  latest: options.latest
})

const pathProbe = (id: string): ((exec: ProbeExecutor) => ProbeResult) =>
  (exec) =>
    exec.commandExists(id)
      ? { state: "present", path: exec.which(id) }
      : { state: "missing" }

const versionProbe = (
  id: string,
  versionArgs: ReadonlyArray<string> = ["--version"],
  parse: (out: string) => string = (out) => out
): ((exec: ProbeExecutor) => string) =>
  (exec) => parse(exec.capture(id, versionArgs))

const home = (): string => {
  const envHome = process.env["HOME"]
  return envHome !== undefined && envHome !== "" ? envHome : homedir()
}


// The resolved path gets persisted into global direct-exec hooks, so a
// relative `which` hit (relative PATH entry, relative BUN_INSTALL) would
// break outside the sync working directory.

const findBun = (exec: ProbeExecutor): { command: string; path: string } | undefined => {
  const onPath = exec.which("bun")
  if (onPath !== "" && isAbsolute(onPath)) {
    return { command: "bun", path: onPath }
  }
  const root =
    process.env["BUN_INSTALL"] !== undefined && process.env["BUN_INSTALL"] !== ""
      ? process.env["BUN_INSTALL"]!
      : p(home(), ".bun")
  for (const candidate of [p(root, "bin", "bun"), p(home(), ".bun", "bin", "bun")]) {
    const found = exec.which(candidate)
    if (found !== "" && isAbsolute(found)) return { command: found, path: found }
  }
  return undefined
}

const resolveBun = (exec: ProbeExecutor): ProbeResult => {
  const bun = findBun(exec)
  return bun === undefined
    ? { state: "missing" }
    : { state: "present", path: bun.path }
}

const resolveEffectSolutions = (exec: ProbeExecutor): ProbeResult => {
  return exec.commandExists("effect-solutions")
    ? { state: "present", path: exec.which("effect-solutions") }
    : { state: "missing" }
}

const versionBunCommand = (exec: ProbeExecutor): string =>
  exec.commandExists("bun") ? "bun" : p(home(), ".bun", "bin", "bun")

const versionEffectSolutions = (exec: ProbeExecutor): string => {
  const bun = versionBunCommand(exec)
  if (bun !== "bun" && exec.which(bun) === "") return ""
  const match = /effect-solutions@([0-9][0-9.]*)/.exec(exec.capture(bun, ["pm", "-g", "ls"]))
  return match?.[1] ?? ""
}

const locateEffectSolutions = (exec: ProbeExecutor): DependencyLocation => {
  const strictBun = findBun(exec)
  const pathBun = exec.which("bun")
  const bun = strictBun ?? (pathBun !== "" ? { command: "bun", path: pathBun } : undefined)
  if (bun === undefined) return { path: "", binDir: "" }
  const globalBin = exec.capture(bun.command, ["pm", "-g", "bin"])
  const path = globalBin !== "" ? p(globalBin, "effect-solutions") : ""
  const resolved = path !== "" && exec.which(path) !== "" ? path : ""
  return { path: resolved, binDir: globalBin }
}

const resolveChrome = (exec: ProbeExecutor, platform: NodeJS.Platform): ProbeResult => {
  const root = p(home(), ".agent-browser", "browsers")
  const relative =
    platform === "darwin"
      ? "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
      : "chrome"
  if (existsSync(root)) {
    for (const directory of readdirSync(root).filter((name) => name.startsWith("chrome-")).sort().reverse()) {
      const path = exec.which(p(root, directory, relative))
      if (path !== "") return { state: "present", path }
    }
  }
  for (const command of ["chrome-for-testing", "google-chrome-for-testing", "google-chrome", "chromium", "chromium-browser", "brave-browser", "brave"]) {
    const path = exec.which(command)
    if (path !== "") return { state: "present", path }
  }
  return { state: "missing" }
}

const latestRtk = (exec: ProbeExecutor): string => {
  if (!exec.commandExists("curl")) return ""
  const doc = parseJson(
    exec.capture("curl", ["-fsSL", "--max-time", "5", "https://api.github.com/repos/rtk-ai/rtk/releases/latest"])
  )
  const tag = doc !== undefined && isObject(doc) && typeof doc["tag_name"] === "string" ? doc["tag_name"] : ""
  return tag.replace(/^v/, "")
}

const latestNpm = (id: "agent-browser" | "effect-solutions") => (exec: ProbeExecutor): string =>
  exec.commandExists("npm") ? exec.capture("npm", ["view", id, "version"]) : ""

export const defaultProbeExecutor: ProbeExecutor = { commandExists, capture, which }

export const DEPENDENCIES: Record<ToolId, DependencySpec> = {
  git: spec(
    "git",
    "optional",
    (pf = rawPlatform()) =>
      pf === "darwin"
        ? "brew install git"
        : "sudo apt install -y git (or your distro's package manager)",
    { version: versionProbe("git") }
  ),
  jq: spec("jq", "optional", (pf = rawPlatform()) =>
    pf === "darwin"
      ? "brew install jq"
      : "sudo apt install -y jq",
    { version: versionProbe("jq") }
  ),
  curl: spec("curl", "optional", (pf = rawPlatform()) =>
    pf === "darwin" ? "brew install curl" : "sudo apt install -y curl",
    { version: versionProbe("curl") }
  ),
  node: spec("node", "optional", () => "install Node.js via https://nodejs.org (or your package manager)", {
    version: versionProbe("node")
  }),
  npm: spec("npm", "optional", () => "ships with Node.js — install via https://nodejs.org (or your package manager)"),
  npx: spec("npx", "optional", () => "ships with Node.js — install via https://nodejs.org (or your package manager)"),
  claude: spec(
    "claude",
    "optional",
    () => "curl -fsSL https://claude.ai/install.sh -o /tmp/claude-install.sh && bash /tmp/claude-install.sh",
    { version: versionProbe("claude") }
  ),
  codex: spec(
    "codex",
    "optional",
    () => 'tmp=$(mktemp) && curl -fsSL https://chatgpt.com/codex/install.sh -o "$tmp" && CODEX_NON_INTERACTIVE=1 sh "$tmp"',
    { version: versionProbe("codex") }
  ),
  rtk: spec("rtk", "optional", () => "see https://github.com/rtk-ai/rtk (kit auto-install is Linux/macOS-only)", {
    version: versionProbe("rtk"),
    latest: latestRtk
  }),
  "session-relay": spec("session-relay", "optional", () => "docks-kit toolchain ensure session-relay", {
    resolve: (exec) => pathProbe(p(home(), ".local", "bin", "session-relay"))(exec),
    version: (exec) => exec.capture(p(home(), ".local", "bin", "session-relay"), ["--version"]),
    locate: () => ({ path: p(home(), ".local", "bin", "session-relay"), binDir: p(home(), ".local", "bin") })
  }),
  bun: spec(
    "bun",
    "optional",
    () => "curl -fsSL https://bun.sh/install | bash",
    {
      resolve: resolveBun,
      version: (exec) => exec.capture(versionBunCommand(exec), ["--version"]),
      locate: (exec) => ({ path: findBun(exec)?.path ?? "", binDir: "" })
    }
  ),
  bwrap: spec("bwrap", "optional", () => "sudo apt install -y bubblewrap (or dnf/pacman/zypper equivalent)"),
  "agent-browser": spec("agent-browser", "optional", () => "npm install -g agent-browser", {
    version: versionProbe("agent-browser"),
    latest: latestNpm("agent-browser")
  }),
  "effect-solutions": spec("effect-solutions", "optional", () => "bun add -g effect-solutions", {
    resolve: resolveEffectSolutions,
    version: versionEffectSolutions,
    locate: locateEffectSolutions,
    latest: latestNpm("effect-solutions")
  }),
  "chrome-for-testing": spec(
    "chrome-for-testing",
    "optional",
    (pf = rawPlatform()) => (pf === "linux" ? "agent-browser install --with-deps" : "agent-browser install"),
    { resolve: resolveChrome }
  ),
  ffplay: spec(
    "ffplay",
    "optional",
    (pf = rawPlatform()) =>
      pf === "darwin" ? "brew install ffmpeg" : "sudo apt install -y ffmpeg",
    { versionArgs: ["-version"], resolve: pathProbe("ffplay") }
  ),
  intelephense: spec("intelephense", "optional", () => "npm install -g intelephense", {
    resolve: pathProbe("intelephense")
  }),
  "typescript-language-server": spec(
    "typescript-language-server",
    "optional",
    () => "npm install -g typescript-language-server typescript",
    { resolve: pathProbe("typescript-language-server") }
  ),
  tsc: spec("tsc", "optional", () => "npm install -g typescript", {
    resolve: pathProbe("tsc"),
    version: versionProbe("tsc")
  }),
  "apt-get": spec("apt-get", "optional", () => "install apt via your Linux distribution"),
  dnf: spec("dnf", "optional", () => "install dnf via your Linux distribution"),
  pacman: spec("pacman", "optional", () => "install pacman via your Linux distribution"),
  zypper: spec("zypper", "optional", () => "install zypper via your Linux distribution")
}

export function resolveDependency(
  specification: DependencySpec,
  exec: ProbeExecutor,
  platform: NodeJS.Platform = rawPlatform()
): ProbeResult {
  return (specification.resolve ?? pathProbe(specification.id))(exec, platform)
}

export function resolveVersion(specification: DependencySpec, exec: ProbeExecutor): string {
  if (resolveDependency(specification, exec).state !== "present") return ""
  return (specification.version ?? versionProbe(specification.id, specification.versionArgs))(exec)
}

export function resolveLocation(
  specification: DependencySpec,
  exec: ProbeExecutor,
  platform: NodeJS.Platform = rawPlatform()
): DependencyLocation {
  if (specification.locate !== undefined) return specification.locate(exec, platform)
  const result = resolveDependency(specification, exec, platform)
  return { path: result.state === "present" ? (result.path ?? exec.which(specification.id)) : "", binDir: "" }
}

export function resolvePath(specification: DependencySpec, exec: ProbeExecutor, platform?: NodeJS.Platform): string {
  return resolveLocation(specification, exec, platform).path
}
