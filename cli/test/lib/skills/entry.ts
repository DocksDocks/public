/**
 * The entry that the skill suites spawn, chosen by `SKILL_GUARD_ENTRY`:
 *
 * - `mjs` (the default): `node SoT/.omp/plugin/skills/write-skill/scripts/skill-guard.mjs <validate|score> [args]`,
 *   the script that `docks-kit skill` replaces.
 * - `docks-kit`: `docks-kit skill <guard|score> [args]` through the CLI test entry, as the agent-docs suites spawn
 *   `docks-kit agent-docs`.
 *
 * Both entries must print the same bytes and exit with the same status, except for what this module maps: the
 * command words, the usage lines, the folder that `score` reads without a root, and the runtime differences of
 * decision 1a of DocksDocks/public#205 (a file error the script does not catch, and the runtime's own stderr).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { outputText } from "../agentDocs/entry";
import { BUN_RUNTIME, cliEntry } from "../cliEntry";
import { REPO_DIR } from "../goldenResources";

export type SkillGuardEntry = "mjs" | "docks-kit";

/** The variable that selects the entry. */
export const SKILL_GUARD_ENTRY_ENV = "SKILL_GUARD_ENTRY";

function selectedEntry(): SkillGuardEntry {
  const value = process.env[SKILL_GUARD_ENTRY_ENV];
  if (value === undefined || value === "" || value === "mjs") return "mjs";
  if (value === "docks-kit") return value;
  throw new Error(`${SKILL_GUARD_ENTRY_ENV} must be 'mjs' or 'docks-kit', not '${value}'`);
}

/** The entry that this run spawns. */
export const SKILL_GUARD_ENTRY: SkillGuardEntry = selectedEntry();

const SKILL_GUARD_SCRIPT = join(
  REPO_DIR,
  "SoT",
  ".omp",
  "plugin",
  "skills",
  "write-skill",
  "scripts",
  "skill-guard.mjs",
);

/** The command of `docks-kit skill <command>`; the script calls `guard` `validate`. */
export type SkillCommand = "guard" | "score";

const SCRIPT_WORDS: Readonly<Record<SkillCommand, string>> = { guard: "validate", score: "score" };

/** The usage line, without its newline, of `guard` without a skill folder (exit 2). */
export const GUARD_USAGE =
  SKILL_GUARD_ENTRY === "mjs"
    ? "usage: skill-guard.mjs validate [--strict] <skill-dir|skills-root> ..."
    : "usage: docks-kit skill guard [--strict] <skill-dir|skills-root> ...";

/** The usage line, without its newline, of a run without a command or with an unknown one (exit 2). */
export const SKILL_USAGE =
  SKILL_GUARD_ENTRY === "mjs"
    ? "usage: skill-guard.mjs validate [--strict] <dir>... | score [--per-file] [root]"
    : "usage: docks-kit skill guard [--strict] <dir>... | score [--per-file] [root]";

/** The folder, relative to the working folder, that `score` reads when no root is given. */
export const DEFAULT_SCORE_ROOT =
  SKILL_GUARD_ENTRY === "mjs" ? "plugins/docks/skills" : ".agents/skills";

export type SkillResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

export type RunOptions = { readonly cwd: string; readonly env: NodeJS.ProcessEnv };

/** Run the entry with the words that follow `skill-guard.mjs` or `docks-kit skill`, unmapped. */
export function runRaw(words: ReadonlyArray<string>, options: RunOptions): SkillResult {
  const [program, prefix] =
    SKILL_GUARD_ENTRY === "mjs"
      ? ["node", [SKILL_GUARD_SCRIPT]]
      : [BUN_RUNTIME, [cliEntry(), "skill"]];
  const result = spawnSync(program, [...prefix, ...words], { cwd: options.cwd, env: options.env });
  if (result.error !== undefined) throw result.error;
  return {
    status: result.status,
    stdout: outputText(result.stdout),
    stderr: outputText(result.stderr),
  };
}

/** Run `<command> <args>`: `validate` or `score` of the script, `guard` or `score` of `docks-kit skill`. */
export function runSkill(
  command: SkillCommand,
  args: ReadonlyArray<string>,
  options: RunOptions,
): SkillResult {
  return runRaw([SKILL_GUARD_ENTRY === "mjs" ? SCRIPT_WORDS[command] : command, ...args], options);
}

/**
 * What stderr holds after a file error that the script does not catch (decision 1a (1)): the script ends with a Node
 * stack trace, which must hold the error code; `docks-kit skill` prints exactly one line that names the error.
 */
export type FileErrorStderr =
  | { readonly kind: "exact"; readonly text: string }
  | { readonly kind: "contains"; readonly text: string };

/** The stderr expectation of a file error with this Node `message` (it starts with the error code). */
export function fileErrorStderr(message: string): FileErrorStderr {
  if (SKILL_GUARD_ENTRY === "docks-kit")
    return { kind: "exact", text: `docks-kit skill: ${message}\n` };
  const code = /^[A-Z]+/.exec(message)?.[0];
  if (code === undefined) throw new Error(`a file error message starts with its code: ${message}`);
  return { kind: "contains", text: code };
}

/**
 * The stderr that the runtime of the entry writes in `options.cwd` before any command code runs (decision 1a (2)):
 * for `docks-kit`, what `bun -e 0` writes there, such as Bun's parse error for an invalid `package.json` in that
 * folder or a parent folder; Node reads no `package.json` for a `.mjs` script, so nothing for `mjs`.
 */
export function runtimeStderr(options: RunOptions): string {
  if (SKILL_GUARD_ENTRY === "mjs") return "";
  const result = spawnSync(BUN_RUNTIME, ["-e", "0"], { cwd: options.cwd, env: options.env });
  if (result.error !== undefined) throw result.error;
  return outputText(result.stderr);
}
