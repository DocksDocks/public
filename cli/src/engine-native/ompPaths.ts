/**
 * omp path resolution, mirroring upstream `packages/utils/src/dirs.ts`
 * `DirResolver`. The kit deploys into two different roots and must not guess
 * either one: the agent directory holds `AGENTS.md`, `config.yml`, and
 * `mcp.json`; the data root holds `marketplaces.json` and `plugins/`.
 *
 * Resolution reads the environment and probes directory existence only, so a
 * dry run stays free of omp subcommands.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { p } from "./exec";

/** Upstream CONFIG_DIR_NAME; PI_CONFIG_DIR renames this directory under home. */
const DEFAULT_CONFIG_DIR_NAME = ".omp";
/** Upstream APP_NAME, the fixed segment under an XDG category root. */
const APP_NAME = "omp";
/** Upstream PROFILE_NAME_RE. An invalid name degrades to the default profile. */
const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** Windows device aliases upstream rejects, bare or with any extension. */
const WINDOWS_RESERVED_BASENAME_RE = /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?$/i;

export interface OmpPaths {
  /** undefined for the default profile, else the normalized profile name */
  readonly profile: string | undefined;
  /** config root for the active profile */
  readonly configRoot: string;
  /** directory holding AGENTS.md, config.yml, mcp.json - never XDG-redirected */
  readonly agentDir: string;
  /** root holding marketplaces.json and plugins/ - XDG-redirected when adopted */
  readonly dataRoot: string;
}

export interface OmpPathInputs {
  readonly home: string;
  readonly env: Record<string, string | undefined>;
  readonly platform: NodeJS.Platform;
}

/**
 * Upstream `normalizeProfileName`, minus the throw: an invalid value reaches
 * `readProfileFromEnvSafe`, which degrades to the default profile so a bad env
 * var cannot crash a bare import.
 */
function normalizeProfile(value: string | undefined): string | undefined {
  const name = value?.trim();
  if (name === undefined || name === "" || name === "default") return undefined;
  if (name === "." || name === ".." || name.endsWith(".")) return undefined;
  if (!PROFILE_NAME_RE.test(name) || WINDOWS_RESERVED_BASENAME_RE.test(name)) return undefined;
  return name;
}

export function ompPaths({ home, env, platform }: OmpPathInputs): OmpPaths {
  // OMP_PROFILE wins whenever it is defined, including when explicitly empty;
  // PI_PROFILE is only the legacy fallback.
  const profile = normalizeProfile(
    env["OMP_PROFILE"] !== undefined ? env["OMP_PROFILE"] : env["PI_PROFILE"],
  );

  // PI_CONFIG_DIR is a config root dirname joined under home, not a path.
  const configDirName = env["PI_CONFIG_DIR"];
  const baseRoot = p(
    home,
    configDirName !== undefined && configDirName !== "" ? configDirName : DEFAULT_CONFIG_DIR_NAME,
  );
  const configRoot = profile === undefined ? baseRoot : p(baseRoot, "profiles", profile);

  // A named profile derives its own agent directory and ignores the override.
  // The default profile also ignores an override that equals the agent
  // directory of the PI_PROFILE profile, because omp exports that value in a
  // profile session. Upstream compares the raw string here.
  // Upstream applies `path.resolve` to a used override. The call anchors a
  // relative value at cwd and normalizes an absolute value.
  const agentOverride = env["PI_CODING_AGENT_DIR"];
  const defaultAgentDir = p(configRoot, "agent");
  const legacyProfile = normalizeProfile(env["PI_PROFILE"]);
  const overrideIgnored =
    profile === undefined &&
    legacyProfile !== undefined &&
    agentOverride === p(baseRoot, "profiles", legacyProfile, "agent");
  const agentDir =
    profile === undefined && !overrideIgnored && agentOverride !== undefined && agentOverride !== ""
      ? resolve(agentOverride)
      : defaultAgentDir;

  return {
    profile,
    configRoot,
    agentDir,
    dataRoot: xdgDataRoot(env, platform, profile, agentDir === defaultAgentDir) ?? configRoot,
  };
}

/**
 * XDG is a Linux and macOS convention upstream disables whenever an agent-dir
 * override is active, and adopts a category only once its omp directory
 * exists - `omp config init-xdg` creates it without moving existing data. A
 * named profile keys on its own `profiles/<name>` path and adopts that path,
 * so a profile stays where it was first activated.
 */
function xdgDataRoot(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  profile: string | undefined,
  agentDirIsDefault: boolean,
): string | undefined {
  if (!agentDirIsDefault) return undefined;
  if (platform !== "linux" && platform !== "darwin") return undefined;

  const dataHome = env["XDG_DATA_HOME"];
  if (dataHome === undefined || dataHome === "") return undefined;

  const appRoot = p(dataHome, APP_NAME);
  const candidate = profile === undefined ? appRoot : p(appRoot, "profiles", profile);
  return existsSync(candidate) ? candidate : undefined;
}
