/**
 * The entry that the skill suites spawn: `docks-kit skill <guard|score> [args]` through the CLI test entry, as the
 * agent-docs suites spawn `docks-kit agent-docs`.
 */
import { spawnSync } from "node:child_process";

import { outputText } from "../agentDocs/entry";
import { BUN_RUNTIME, cliEntry } from "../cliEntry";

/** The command of `docks-kit skill <command>`. */
export type SkillCommand = "guard" | "score";

/** The usage line, without its newline, of `guard` without a skill folder (exit 2). */
export const GUARD_USAGE = "usage: docks-kit skill guard [--strict] <skill-dir|skills-root> ...";

/** The usage line, without its newline, of a run without a command or with an unknown one (exit 2). */
export const SKILL_USAGE =
  "usage: docks-kit skill guard [--strict] <dir>... | score [--per-file] [root]";

export type SkillResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

export type RunOptions = { readonly cwd: string; readonly env: NodeJS.ProcessEnv };

/** Run `docks-kit skill <words>`. */
export function runRaw(words: ReadonlyArray<string>, options: RunOptions): SkillResult {
  const result = spawnSync(BUN_RUNTIME, [cliEntry(), "skill", ...words], {
    cwd: options.cwd,
    env: options.env,
  });
  if (result.error !== undefined) throw result.error;
  return {
    status: result.status,
    stdout: outputText(result.stdout),
    stderr: outputText(result.stderr),
  };
}

/** Run `docks-kit skill <command> <args>`. */
export function runSkill(
  command: SkillCommand,
  args: ReadonlyArray<string>,
  options: RunOptions,
): SkillResult {
  return runRaw([command, ...args], options);
}

/**
 * The stderr that the runtime writes in `options.cwd` on its own, at a point that its event loop picks: what `bun -e 0`
 * writes there, such as Bun's parse error for an invalid `package.json` in that folder or a parent folder. A compiled
 * binary writes no such text.
 */
export function runtimeStderr(options: RunOptions): string {
  const result = spawnSync(BUN_RUNTIME, ["-e", "0"], { cwd: options.cwd, env: options.env });
  if (result.error !== undefined) throw result.error;
  return outputText(result.stderr);
}
