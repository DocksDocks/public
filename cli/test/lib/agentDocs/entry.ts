/**
 * The entry that the agent-docs suites spawn, chosen by `AGENT_DOCS_ENTRY`.
 *
 * - `mjs` (the default) spawns `node <script> <command> [args]` for the helper
 *   scripts under `SoT/.omp/plugin/skills/`.
 * - `docks-kit` spawns `docks-kit agent-docs <helper> <command> [args]` through
 *   the CLI test entry, as the plan suites spawn `docks-kit plan`.
 *
 * Both entries print the same bytes and exit with the same status, except the
 * usage line, the only output that names the entry; `usageLine` gives it.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { REPO_DIR } from "../goldenResources";
import { BUN_RUNTIME, cliEntry } from "../cliEntry";

export const AGENT_DOCS_ENTRY_ENV = "AGENT_DOCS_ENTRY";

const ENTRIES = ["mjs", "docks-kit"] as const;
export type AgentDocsEntry = (typeof ENTRIES)[number];

function isEntry(value: string): value is AgentDocsEntry {
  return ENTRIES.some((entry) => entry === value);
}

function selectedEntry(): AgentDocsEntry {
  const value = process.env[AGENT_DOCS_ENTRY_ENV];
  if (value === undefined || value === "") return "mjs";
  if (!isEntry(value)) {
    throw new Error(`${AGENT_DOCS_ENTRY_ENV} is '${value}'; use ${ENTRIES.join(" or ")}`);
  }
  return value;
}

export const AGENT_DOCS_ENTRY: AgentDocsEntry = selectedEntry();

/** The helper word of `docks-kit agent-docs <helper>`. */
export type Helper = "pr-template" | "verify-skill" | "agent-first" | "bridge-check";

const SKILLS = join(REPO_DIR, "SoT", ".omp", "plugin", "skills");

const SCRIPTS: Readonly<Record<Helper, string>> = {
  "pr-template": join(SKILLS, "plan-workspace", "scripts", "pr-template.mjs"),
  "verify-skill": join(SKILLS, "plan-workspace", "scripts", "verify-skill.mjs"),
  "agent-first": join(SKILLS, "agent-first-setup", "scripts", "agent-first-check.mjs"),
  "bridge-check": join(SKILLS, "claude-md-migration", "scripts", "bridge-check.mjs"),
};

/** The commands of each helper, as its usage line lists them. */
const COMMANDS: Readonly<Record<Helper, string>> = {
  "pr-template": "detect | gate",
  "verify-skill": "detect | write-gate <path>... | entry-gate",
  "agent-first": "detect | check | convert-agent <path>",
  "bridge-check": "audit | verify [--expect <path>]...",
};

const SCRIPT_NAMES: Readonly<Record<Helper, string>> = {
  "pr-template": "pr-template.mjs",
  "verify-skill": "verify-skill.mjs",
  "agent-first": "agent-first-check.mjs",
  "bridge-check": "bridge-check.mjs",
};

/** The usage line, without its newline, that the selected entry prints for `helper`. */
export function usageLine(helper: Helper): string {
  const name = AGENT_DOCS_ENTRY === "mjs" ? SCRIPT_NAMES[helper] : `docks-kit agent-docs ${helper}`;
  return `usage: ${name} ${COMMANDS[helper]}`;
}

export type HelperResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

// A fatal decoder throws on a byte that is not UTF-8, so equal strings mean equal bytes.
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

/** Run `<helper> <args>` through the selected entry. */
export function runHelper(
  helper: Helper,
  args: ReadonlyArray<string>,
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
): HelperResult {
  const [command, argv] =
    AGENT_DOCS_ENTRY === "mjs"
      ? ["node", [SCRIPTS[helper], ...args]]
      : [BUN_RUNTIME, [cliEntry(), "agent-docs", helper, ...args]];
  const result = spawnSync(command, argv, { cwd: options.cwd, env: options.env });
  if (result.error !== undefined) throw result.error;
  return {
    status: result.status,
    stdout: STRICT_UTF8.decode(result.stdout),
    stderr: STRICT_UTF8.decode(result.stderr),
  };
}
