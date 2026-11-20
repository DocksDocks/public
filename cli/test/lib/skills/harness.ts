/**
 * The skill suites' harness: fixture folders from the agent-docs harness, runs through `entry.ts`, and the skill
 * texts and expected lines that several cases share. Each case runs in its fixture folder and passes relative paths,
 * so the paths that the output names do not depend on the temporary folder.
 */
import { join } from "node:path";
import { expect } from "vitest";

import { type Fixture, output } from "../agentDocs/harness";
import {
  type SkillCommand,
  type SkillResult,
  runRaw,
  runSkill,
  runtimeStderr as entryRuntimeStderr,
} from "./entry";

/** The fixtures need POSIX modes and symlinks, and the output names POSIX paths. */
export const SKILLS_HOST_SUPPORTED = process.platform !== "win32";

/** Run `<command> <args>` in the fixture folder, or in its subfolder `sub`. */
export function run(
  command: SkillCommand,
  args: ReadonlyArray<string>,
  fx: Fixture,
  sub = "",
): SkillResult {
  return runSkill(command, args, { cwd: join(fx.dir, sub), env: fx.env });
}

/** Run the entry with unmapped words in the fixture folder. */
export function runWords(words: ReadonlyArray<string>, fx: Fixture): SkillResult {
  return runRaw(words, { cwd: fx.dir, env: fx.env });
}

/** The stderr that the entry's runtime writes in the fixture folder on its own, apart from the command (see entry.ts). */
export function runtimeStderr(fx: Fixture, sub = ""): string {
  return entryRuntimeStderr({ cwd: join(fx.dir, sub), env: fx.env });
}

/**
 * A run whose runtime writes its own stderr (decision 1a (2)): status and stdout exactly; stderr holds `runtime`
 * exactly once, and without it equals `stderr` exactly. Bun writes its text when its event loop reaches it, before or
 * after the command's own writes, so the check pins no order. With no runtime text (a compiled binary), stderr equals
 * `stderr`.
 */
export function expectRuntimeRun(
  result: SkillResult,
  status: number,
  lines: ReadonlyArray<string>,
  runtime: string,
  stderr = "",
): void {
  expect({ status: result.status, stdout: result.stdout }).toEqual({
    status,
    stdout: output(lines),
  });
  if (runtime === "") {
    expect(result.stderr).toBe(stderr);
    return;
  }
  const parts = result.stderr.split(runtime);
  expect(parts.length - 1, `runtime stderr occurrences in ${JSON.stringify(result.stderr)}`).toBe(
    1,
  );
  expect(parts.join("")).toBe(stderr);
}

/**
 * A file error that the former script did not catch (decision 1a (1)): status 1, stdout exactly, and stderr exactly
 * the one line `docks-kit skill: <Node error message>`.
 */
export function expectFileError(
  result: SkillResult,
  lines: ReadonlyArray<string>,
  message: string,
): void {
  expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({
    status: 1,
    stdout: output(lines),
    stderr: `docks-kit skill: ${message}\n`,
  });
}

/** `YYYY-MM-DD` of the UTC day `days` days before today: the rubric and the validator count age in UTC days. */
export function daysAgo(days: number): string {
  const day = new Date(Date.now() - days * 86_400_000);
  return day.toISOString().slice(0, 10);
}

/** A metadata.updated date that the rubric counts as recent and the validator does not warn about. */
export const RECENT = daysAgo(30);

/** `count` body lines that hold no rubric marker. */
export const bodyLines = (count: number): Array<string> =>
  Array.from({ length: count }, (_, i) => `Line ${i + 1}.`);

/** A SKILL.md text: the frontmatter lines between fences, then the body lines; the text ends with a newline. */
export const skillText = (
  frontmatter: ReadonlyArray<string>,
  body: ReadonlyArray<string>,
): string => `${["---", ...frontmatter, "---", ...body].join("\n")}\n`;

/** The score line of the validator for `points`. */
export const scoreLine = (points: number): string =>
  `  score: ${points}/16 (docks rubric; per-file floor set by the project's scoring.json; aim 14+)`;

/** The validator's warning for a body of `lines` lines outside the 80-310 target. */
export const bodyWarning = (lines: number): string =>
  `body is ${lines} lines, outside the 80-310 target (agentskills.io: keep the body under 5000 tokens and 500 lines)`;

export const passed = (skills: number, warnings: number): string =>
  `skill-guard PASSED: ${skills} skill(s), ${warnings} warning(s)`;

export const failed = (failures: number, warnings: number, skills: number): string =>
  `skill-guard FAILED: ${failures} failure(s), ${warnings} warning(s) across ${skills} skill(s)`;
