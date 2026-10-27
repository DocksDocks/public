/**
 * DependencyManager — one home for external-tool identity, presence probing,
 * and platform-correct install hints (Output Policy in DESIGN.md).
 *
 * Ownership split: SoT/toolchain.json + toolchain.ts keep version floors, pin
 * policy, and the doctor report, while bun.ts bunBootstrap owns the one managed
 * install; this registry owns WHICH external tools exist, whether they are
 * required, and the one-line command that installs a missing one.
 */
import { isAbsolute } from "node:path";

import { capture, captureWithin, commandExists, p, which, type CaptureOutcome } from "./exec";
import { engineHome } from "./harnesses";
import { isObject, parseJson } from "./jq";
import { hostOs, platformName, rawPlatform } from "./os";

export type ToolId =
  | "git"
  | "jq"
  | "curl"
  | "node"
  | "npm"
  | "npx"
  | "claude"
  | "codex"
  | "omp"
  | "bun"
  | "bwrap"
  | "ffplay"
  | "intelephense"
  | "typescript-language-server"
  | "tsc"
  | "rust-analyzer"
  | "rustup"
  | "apt-get"
  | "dnf"
  | "pacman"
  | "zypper";

/** required = the engine aborts when missing; optional = warn + degrade. */
export type Requirement = "required" | "optional";

export type ProbeResult =
  | { readonly state: "present"; readonly path?: string }
  | { readonly state: "missing" };

export interface ProbeExecutor {
  readonly commandExists: (name: string) => boolean;
  readonly capture: (cmd: string, args: ReadonlyArray<string>) => Promise<string>;
  /** `capture` with a time limit. Without it, a version probe has no limit. */
  readonly captureWithin?: (
    cmd: string,
    args: ReadonlyArray<string>,
    timeoutMs: number,
  ) => Promise<CaptureOutcome>;
  readonly which: (name: string) => string;
}

/** The version text ("" when the tool is absent or prints none), or no answer in time. */
export type VersionReading =
  | { readonly kind: "version"; readonly value: string }
  | { readonly kind: "timed-out" };

/**
 * The longest wait for a `<tool> --version` answer. A cold rust-analyzer start
 * took 20 s on a macOS runner (#114), so the limit must let that pass.
 */
export const VERSION_PROBE_LIMIT_MS = 60_000;

export interface DependencySpec {
  readonly id: ToolId;
  readonly requirement: Requirement;
  readonly versionArgs: ReadonlyArray<string>;
  /** Platform-correct one-line install command (param injectable for tests). */
  readonly installHint: (platform?: NodeJS.Platform) => string;
  readonly resolve?: (exec: ProbeExecutor, platform: NodeJS.Platform) => ProbeResult;
  /**
   * Reads the version in a different way than `<id> <versionArgs>`. This
   * reader has no time limit.
   */
  readonly version?: (exec: ProbeExecutor) => Promise<string>;
}

interface SpecOptions {
  readonly versionArgs?: ReadonlyArray<string>;
  readonly resolve?: (exec: ProbeExecutor, platform: NodeJS.Platform) => ProbeResult;
  readonly version?: (exec: ProbeExecutor) => Promise<string>;
}

const spec = (
  id: ToolId,
  requirement: Requirement,
  installHint: (platform?: NodeJS.Platform) => string,
  options: SpecOptions = {},
): DependencySpec => ({
  id,
  requirement,
  versionArgs: options.versionArgs ?? ["--version"],
  installHint,
  resolve: options.resolve,
  version: options.version,
});

// Presence is the injected executor's verdict; `which` only resolves WHERE the
// tool is, which on Windows is the `.cmd`/`.exe` candidate rather than the name.
const pathProbe =
  (id: string): ((exec: ProbeExecutor) => ProbeResult) =>
  (exec) => {
    if (!exec.commandExists(id)) return { state: "missing" };
    const path = exec.which(id);
    return path === "" ? { state: "present" } : { state: "present", path };
  };

/**
 * The resolved path gets persisted into global direct-exec hooks, so a
 * relative `which` hit (relative PATH entry, relative BUN_INSTALL) would
 * break outside the sync working directory.
 */
const findBun = (exec: ProbeExecutor): { command: string; path: string } | undefined => {
  const onPath = exec.which("bun");
  if (onPath !== "" && isAbsolute(onPath)) {
    return { command: "bun", path: onPath };
  }
  const root =
    process.env["BUN_INSTALL"] !== undefined && process.env["BUN_INSTALL"] !== ""
      ? process.env["BUN_INSTALL"]!
      : p(engineHome(), ".bun");
  for (const candidate of [p(root, "bin", "bun"), p(engineHome(), ".bun", "bin", "bun")]) {
    const found = exec.which(candidate);
    if (found !== "" && isAbsolute(found)) return { command: found, path: found };
  }
  return undefined;
};

const resolveBun = (exec: ProbeExecutor): ProbeResult => {
  const bun = findBun(exec);
  return bun === undefined ? { state: "missing" } : { state: "present", path: bun.path };
};

const npmGlobalCache = new WeakMap<ProbeExecutor, Promise<{ [k: string]: string }>>();

/** npm-global package name → version, from `npm ls -g`; memoized per executor. */
export const npmGlobalVersions = (exec: ProbeExecutor): Promise<{ [k: string]: string }> => {
  const hit = npmGlobalCache.get(exec);
  if (hit !== undefined) return hit;
  const pending = (async (): Promise<{ [k: string]: string }> => {
    const out: { [k: string]: string } = {};
    if (exec.commandExists("npm")) {
      const doc = parseJson(await exec.capture("npm", ["ls", "-g", "--depth=0", "--json"]));
      const deps =
        doc !== undefined && isObject(doc) && isObject(doc["dependencies"])
          ? doc["dependencies"]
          : {};
      for (const [name, value] of Object.entries(deps)) {
        if (isObject(value) && typeof value["version"] === "string") out[name] = value["version"];
      }
    }
    return out;
  })();
  npmGlobalCache.set(exec, pending);
  return pending;
};

const versionNpmGlobal =
  (pkg: string) =>
  async (exec: ProbeExecutor): Promise<string> =>
    (await npmGlobalVersions(exec))[pkg] ?? "";

export const defaultProbeExecutor: ProbeExecutor = { commandExists, capture, captureWithin, which };

export const DEPENDENCIES: Record<ToolId, DependencySpec> = {
  git: spec("git", "optional", (pf = rawPlatform()) => hostOs(platformName(pf)).installHint("git")),
  jq: spec("jq", "optional", (pf = rawPlatform()) => hostOs(platformName(pf)).installHint("jq")),
  curl: spec("curl", "optional", (pf = rawPlatform()) =>
    hostOs(platformName(pf)).installHint("curl"),
  ),
  node: spec(
    "node",
    "optional",
    () => "install Node.js via https://nodejs.org (or your package manager)",
  ),
  npm: spec(
    "npm",
    "optional",
    () => "ships with Node.js — install via https://nodejs.org (or your package manager)",
  ),
  npx: spec(
    "npx",
    "optional",
    () => "ships with Node.js — install via https://nodejs.org (or your package manager)",
  ),
  claude: spec("claude", "optional", (pf = rawPlatform()) =>
    hostOs(platformName(pf)).installHint("claude"),
  ),
  codex: spec("codex", "optional", (pf = rawPlatform()) =>
    hostOs(platformName(pf)).installHint("codex"),
  ),
  omp: spec(
    "omp",
    "optional",
    () =>
      "install omp from https://github.com/can1357/oh-my-pi (an existing install updates with `omp update`, or through the tool that manages it, such as Tern)",
    {
      version: async (exec) =>
        (await exec.capture("omp", ["--version"])).trim().replace(/^omp[/v]/, ""),
    },
  ),
  bun: spec("bun", "optional", () => "curl -fsSL https://bun.sh/install | bash", {
    resolve: resolveBun,
    version: async (exec) => {
      const bun = findBun(exec);
      if (bun === undefined) return "";
      return await exec.capture(bun.command, ["--version"]);
    },
  }),
  bwrap: spec(
    "bwrap",
    "optional",
    () => "sudo apt install -y bubblewrap (or dnf/pacman/zypper equivalent)",
  ),
  ffplay: spec(
    "ffplay",
    "optional",
    (pf = rawPlatform()) => hostOs(platformName(pf)).installHint("ffplay"),
    {
      versionArgs: ["-version"],
      resolve: pathProbe("ffplay"),
    },
  ),
  intelephense: spec("intelephense", "optional", () => "npm install -g intelephense", {
    resolve: pathProbe("intelephense"),
    version: versionNpmGlobal("intelephense"),
  }),
  "typescript-language-server": spec(
    "typescript-language-server",
    "optional",
    () => "npm install -g typescript-language-server typescript",
    {
      resolve: pathProbe("typescript-language-server"),
    },
  ),
  tsc: spec("tsc", "optional", () => "npm install -g typescript", {
    resolve: pathProbe("tsc"),
  }),
  "rust-analyzer": spec("rust-analyzer", "optional", () => "rustup component add rust-analyzer", {
    resolve: pathProbe("rust-analyzer"),
  }),
  rustup: spec("rustup", "optional", () => "install the Rust toolchain from https://rustup.rs"),
  "apt-get": spec("apt-get", "optional", () => "install apt via your Linux distribution"),
  dnf: spec("dnf", "optional", () => "install dnf via your Linux distribution"),
  pacman: spec("pacman", "optional", () => "install pacman via your Linux distribution"),
  zypper: spec("zypper", "optional", () => "install zypper via your Linux distribution"),
};

export function resolveDependency(
  specification: DependencySpec,
  exec: ProbeExecutor,
  platform: NodeJS.Platform = rawPlatform(),
): ProbeResult {
  return (specification.resolve ?? pathProbe(specification.id))(exec, platform);
}

/**
 * Reads the version with `<id> <versionArgs>` under `VERSION_PROBE_LIMIT_MS`,
 * or with the spec's own `version` reader. An executor without
 * `captureWithin` reads without a limit and never reports `timed-out`.
 */
export async function resolveVersionReading(
  specification: DependencySpec,
  exec: ProbeExecutor,
): Promise<VersionReading> {
  if (resolveDependency(specification, exec).state !== "present") {
    return { kind: "version", value: "" };
  }
  if (specification.version !== undefined) {
    return { kind: "version", value: await specification.version(exec) };
  }
  if (exec.captureWithin === undefined) {
    return {
      kind: "version",
      value: await exec.capture(specification.id, specification.versionArgs),
    };
  }
  const outcome = await exec.captureWithin(
    specification.id,
    specification.versionArgs,
    VERSION_PROBE_LIMIT_MS,
  );
  if (outcome.kind === "timed-out") return outcome;
  return { kind: "version", value: outcome.kind === "output" ? outcome.stdout : "" };
}

/** `resolveVersionReading` as text: a probe that timed out reads as no version. */
export async function resolveVersion(
  specification: DependencySpec,
  exec: ProbeExecutor,
): Promise<string> {
  const reading = await resolveVersionReading(specification, exec);
  return reading.kind === "version" ? reading.value : "";
}

export async function resolvePath(
  specification: DependencySpec,
  exec: ProbeExecutor,
  platform: NodeJS.Platform = rawPlatform(),
): Promise<string> {
  const result = resolveDependency(specification, exec, platform);
  return result.state === "present" ? (result.path ?? exec.which(specification.id)) : "";
}
