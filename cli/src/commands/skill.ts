import { Argument, Command } from "effect/cli";
import { Effect } from "effect";

import { runSkill } from "../skills/commands";
import { SkillFiles } from "../skills/files";

// `argv.ts` puts a `--` after the `skill` word, so every later word reaches the skill dispatcher as it was given, and
// the dispatcher answers a word it does not know with its own usage line.
const args: Argument.Argument<ReadonlyArray<string>> = Argument.String("args").pipe(
  Argument.withDescription(
    "guard [--strict] <skill-dir|skills-root>..., score [--per-file] [skills-root] (default .agents/skills)",
  ),
  Argument.variadic(),
);

export const skillCommand = Command.make("skill", { args }, (config) =>
  runSkill(config.args).pipe(
    Effect.flatMap((code) =>
      Effect.sync(() => {
        process.exitCode = code;
      }),
    ),
    Effect.provide(SkillFiles.layer),
  ),
).pipe(
  Command.withDescription(
    "SKILL.md checks of the write-skill and skill-maintenance skills: the portable validator and the 16-point docks rubric score.",
  ),
);
