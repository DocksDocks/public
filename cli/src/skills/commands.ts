/**
 * The dispatcher of `docks-kit skill guard|score`, which replaces `write-skill/scripts/skill-guard.mjs validate|score`.
 * Each command prints what the script printed and returns its exit status. A file error that the script did not catch
 * (it ended with a stack trace and exit 1) prints `docks-kit skill: <Node error message>` and returns 1.
 */
import { dirname, join } from "node:path";

import { Clock, Effect, Schema } from "effect";

import type { FileError } from "../plan/types";
import { SkillFiles } from "./files";
import {
  type Finding,
  frontFindings,
  NESTED_REFERENCES,
  scoreLine,
  slopFindings,
  walkSkillFiles,
} from "./guard";
import { scoreSkill, splitLines } from "./rubric";

const USAGE = "usage: docks-kit skill guard [--strict] <dir>... | score [--per-file] [root]";
const GUARD_USAGE = "usage: docks-kit skill guard [--strict] <skill-dir|skills-root> ...";

/** `score` without a root reads the project skills that omp loads. */
const DEFAULT_SCORE_ROOT = ".agents/skills";

/** The arguments do not form a command; the usage line goes to stderr with exit status 2. */
class SkillUsage extends Schema.TaggedError<SkillUsage, { readonly brand: unique symbol }>()(
  "SkillUsage",
  { usage: Schema.String },
) {}

const writeStdout = (text: string): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stdout.write(text);
  });

const writeStderr = (text: string): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stderr.write(text);
  });

/** `score [--per-file] [root]`: one `<name> <score>` line per skill folder, sorted, or the total. */
const score = Effect.fn("skills.score")(function* (args: ReadonlyArray<string>) {
  const files = yield* SkillFiles;
  const nowMillis = yield* Clock.currentTimeMillis;
  const perFile = args.includes("--per-file");
  const root =
    args.find((arg) => !arg.startsWith("--")) ||
    join(yield* files.workingFolder, DEFAULT_SCORE_ROOT);
  const names = (yield* files.readFolder(root)).map((entry) => entry.name).sort();
  let total = 0;
  for (const name of names) {
    const folder = join(root, name);
    if (!(yield* files.isDirectory(folder))) continue;
    const file = join(folder, "SKILL.md");
    if (!(yield* files.exists(file))) continue;
    const points = scoreSkill(yield* files.readFile(file), nowMillis);
    if (perFile) yield* writeStdout(`${name} ${points}\n`);
    total += points;
  }
  if (!perFile) yield* writeStdout(`${total}\n`);
  return 0;
});

/** `guard [--strict] <skill-dir|skills-root>...`: the report of each skill, then the verdict line. */
const guard = Effect.fn("skills.guard")(function* (args: ReadonlyArray<string>) {
  const files = yield* SkillFiles;
  const strict = args.includes("--strict");
  const targets = args.filter((arg) => arg !== "--strict");
  if (targets.length === 0) return yield* new SkillUsage({ usage: GUARD_USAGE });
  const nowMillis = yield* Clock.currentTimeMillis;
  let fails = 0;
  let warns = 0;
  let checked = 0;

  const report = (finding: Finding): Effect.Effect<void> => {
    if (finding.level === "fail") fails += 1;
    else if (strict) fails += 1;
    else warns += 1;
    const label = finding.level === "fail" ? "FAIL" : strict ? "FAIL(strict)" : "WARN";
    return writeStdout(`  ${label}: ${finding.message}\n`);
  };

  const check = Effect.fnUntraced(function* (dir: string) {
    yield* writeStdout(`== ${dir}\n`);
    checked += 1;
    const content = yield* files.readFile(join(dir, "SKILL.md"));
    const lines = splitLines(content);
    yield* Effect.forEach(frontFindings(dir, lines, nowMillis), report, { discard: true });
    const references = join(dir, "references");
    if ((yield* files.exists(references)) && (yield* files.isDirectory(references))) {
      const entries = yield* files.readFolder(references);
      if (entries.some((entry) => entry.isDirectory)) yield* report(NESTED_REFERENCES);
    }
    yield* Effect.forEach(slopFindings(lines), report, { discard: true });
    yield* writeStdout(`${scoreLine(scoreSkill(content, nowMillis))}\n`);
  });

  for (const target of targets) {
    if (yield* files.exists(join(target, "SKILL.md"))) yield* check(target);
    else if ((yield* files.exists(target)) && (yield* files.isDirectory(target))) {
      const found = yield* walkSkillFiles(target);
      if (found.length === 0) {
        yield* writeStderr(`FAIL: no SKILL.md found under ${target}\n`);
        fails += 1;
      }
      for (const file of found) yield* check(dirname(file));
    } else {
      yield* writeStderr(`FAIL: not a directory: ${target}\n`);
      fails += 1;
    }
  }
  if (fails > 0) {
    yield* writeStdout(
      `skill-guard FAILED: ${fails} failure(s), ${warns} warning(s) across ${checked} skill(s)\n`,
    );
    return 1;
  }
  yield* writeStdout(`skill-guard PASSED: ${checked} skill(s), ${warns} warning(s)\n`);
  return 0;
});

const printUsage = (error: SkillUsage): Effect.Effect<number> =>
  writeStderr(`${error.usage}\n`).pipe(Effect.as(2));

const printCrash = (error: FileError): Effect.Effect<number> =>
  writeStderr(`docks-kit skill: ${error.message}\n`).pipe(Effect.as(1));

/** Run `docks-kit skill <args>` and return its exit status. */
export const runSkill = Effect.fn("skills.run")(function* (args: ReadonlyArray<string>) {
  const [command, ...rest] = args;
  const outcome: Effect.Effect<number, SkillUsage | FileError, SkillFiles> =
    command === "score"
      ? score(rest)
      : command === "guard"
        ? guard(rest)
        : Effect.fail(new SkillUsage({ usage: USAGE }));
  return yield* outcome.pipe(Effect.catchTags({ SkillUsage: printUsage, FileError: printCrash }));
});
