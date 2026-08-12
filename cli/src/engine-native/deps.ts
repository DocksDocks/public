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
  | "bun"
  | "bwrap"
  | "effect-solutions"
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
  readonly capture: (cmd: string, args: ReadonlyArray<string>) => Promise<string>
  readonly which: (name: string) => string
}

export interface DependencySpec {
  readonly id: ToolId
  readonly requirement: Requirement
  readonly versionArgs: ReadonlyArray<string>
  /** Platform-correct one-line install command (param injectable for tests). */
  readonly installHint: (platform?: NodeJS.Platform) => string
  readonly resolve?: (exec: ProbeExecutor, platform: NodeJS.Platform) => ProbeResult
  readonly version?: (exec: ProbeExecutor) => Promise<string>
  readonly locate?: (exec: ProbeExecutor, platform: NodeJS.Platform) => Promise<DependencyLocation>
  readonly latest?: (exec: ProbeExecutor) => Promise<string>
}

interface SpecOptions {
  readonly versionArgs?: ReadonlyArray<string>
  readonly resolve?: (exec: ProbeExecutor, platform: NodeJS.Platform) => ProbeResult
  readonly version?: (exec: ProbeExecutor) => Promise<string>
  readonly locate?: (exec: ProbeExecutor, platform: NodeJS.Platform) => Promise<DependencyLocation>
  readonly latest?: (exec: ProbeExecutor) => Promise<string>
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
): ((exec: ProbeExecutor) => Promise<string>) =>
  async (exec) => parse(await exec.capture(id, versionArgs))

const home = (): string => {
  const envHome = process.env["HOME"]
  return envHome !== undefined && envHome !== "" ? envHome : homedir()
}

/**
 * The resolved path gets persisted into global direct-exec hooks, so a
 * relative `which` hit (relative PATH entry, relative BUN_INSTALL) would
 * break outside the sync working directory.
 */
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

const versionEffectSolutions = async (exec: ProbeExecutor): Promise<string> => {
  const bun = findBun(exec)
  if (bun === undefined) return ""
  const match = /effect-solutions@([0-9][0-9.]*)/.exec(await exec.capture(bun.command, ["pm", "-g", "ls"]))
  return match?.[1] ?? ""
}

const locateEffectSolutions = async (exec: ProbeExecutor): Promise<DependencyLocation> => {
  const strictBun = findBun(exec)
  const pathBun = exec.which("bun")
  // This site may accept a relative hit because it does not persist the Bun path.
  const bunForGlobalBin = strictBun?.command ?? (pathBun !== "" ? "bun" : undefined)
  if (bunForGlobalBin === undefined) return { path: "", binDir: "" }
  const globalBin = await exec.capture(bunForGlobalBin, ["pm", "-g", "bin"])
  const path = globalBin !== "" ? p(globalBin, "effect-solutions") : ""
  const resolved = path !== "" && exec.which(path) !== "" ? path : ""
  return { path: resolved, binDir: globalBin }
}

const npmGlobalCache = new WeakMap<ProbeExecutor, Promise<{ [k: string]: string }>>()

const npmGlobalVersions = (exec: ProbeExecutor): Promise<{ [k: string]: string }> => {
  const hit = npmGlobalCache.get(exec)
  if (hit !== undefined) return hit
  const pending = (async (): Promise<{ [k: string]: string }> => {
    const out: { [k: string]: string } = {}
    if (exec.commandExists("npm")) {
      const doc = parseJson(await exec.capture("npm", ["ls", "-g", "--depth=0", "--json"]))
      const deps = doc !== undefined && isObject(doc) && isObject(doc["dependencies"]) ? doc["dependencies"] : {}
      for (const [name, value] of Object.entries(deps)) {
        if (isObject(value) && typeof value["version"] === "string") out[name] = value["version"]
      }
    }
    return out
  })()
  npmGlobalCache.set(exec, pending)
  return pending
}

const versionNpmGlobal = (pkg: string) => async (exec: ProbeExecutor): Promise<string> =>
  (await npmGlobalVersions(exec))[pkg] ?? ""

const latestNpm = (id: "effect-solutions") => async (exec: ProbeExecutor): Promise<string> =>
  exec.commandExists("npm") ? await exec.capture("npm", ["view", id, "version"]) : ""

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
  bun: spec(
    "bun",
    "optional",
    () => "curl -fsSL https://bun.sh/install | bash",
    {
      resolve: resolveBun,
      version: async (exec) => {
        const bun = findBun(exec)
        if (bun === undefined) return ""
        return await exec.capture(bun.command, ["--version"])
      },
      locate: async (exec) => ({ path: findBun(exec)?.path ?? "", binDir: "" })
    }
  ),
  bwrap: spec("bwrap", "optional", () => "sudo apt install -y bubblewrap (or dnf/pacman/zypper equivalent)", {
    version: versionProbe("bwrap")
  }),
  "effect-solutions": spec("effect-solutions", "optional", () => "bun add -g effect-solutions", {
    resolve: resolveEffectSolutions,
    version: versionEffectSolutions,
    locate: locateEffectSolutions,
    latest: latestNpm("effect-solutions")
  }),
  ffplay: spec(
    "ffplay",
    "optional",
    (pf = rawPlatform()) =>
      pf === "darwin" ? "brew install ffmpeg" : "sudo apt install -y ffmpeg",
    { versionArgs: ["-version"], version: versionProbe("ffplay", ["-version"]), resolve: pathProbe("ffplay") }
  ),
  intelephense: spec("intelephense", "optional", () => "npm install -g intelephense", {
    resolve: pathProbe("intelephense"),
    version: versionNpmGlobal("intelephense")
  }),
  "typescript-language-server": spec(
    "typescript-language-server",
    "optional",
    () => "npm install -g typescript-language-server typescript",
    { resolve: pathProbe("typescript-language-server"), version: versionProbe("typescript-language-server") }
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

export async function resolveVersion(specification: DependencySpec, exec: ProbeExecutor): Promise<string> {
  if (resolveDependency(specification, exec).state !== "present") return ""
  return await (specification.version ?? versionProbe(specification.id, specification.versionArgs))(exec)
}

export async function resolveLocation(
  specification: DependencySpec,
  exec: ProbeExecutor,
  platform: NodeJS.Platform = rawPlatform()
): Promise<DependencyLocation> {
  if (specification.locate !== undefined) return await specification.locate(exec, platform)
  const result = resolveDependency(specification, exec, platform)
  return { path: result.state === "present" ? (result.path ?? exec.which(specification.id)) : "", binDir: "" }
}

export async function resolvePath(
  specification: DependencySpec,
  exec: ProbeExecutor,
  platform?: NodeJS.Platform
): Promise<string> {
  return (await resolveLocation(specification, exec, platform)).path
}
