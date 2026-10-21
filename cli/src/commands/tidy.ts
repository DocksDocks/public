import { resolve } from "node:path";

import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";

import { bail } from "../engine";
import { engineHome } from "../engine-native/harnesses";
import { scratchRoot } from "../engine-native/scratch";
import {
  actionSubject,
  actionVerb,
  agentWorktreeRoot,
  applyTidy,
  defaultTidyHost,
  mainRepository,
  planTidy,
  type TidyInputs,
} from "../engine-native/tidy";
import { buildTidyReport } from "../engine-native/tidyReport";

const apply = Flag.Boolean("apply").pipe(
  Flag.withDescription("Perform the listed actions"),
  Flag.withDefault(false),
);
const repo = Flag.String("repo").pipe(
  Flag.withDescription("Take worktree candidates only from this repository, at any location"),
  Flag.optional,
);
const report = Flag.Boolean("report").pipe(
  Flag.withDescription("Also list other disk and memory use (read-only)"),
  Flag.withDefault(false),
);

export const tidyCommand = Command.make("tidy", { apply, repo, report }, (config) =>
  Effect.gen(function* () {
    const host = defaultTidyHost();
    const home = engineHome();
    let repository: string | undefined;
    if (Option.isSome(config.repo)) {
      const typed = config.repo.value;
      repository = yield* Effect.promise(() => mainRepository(resolve(process.cwd(), typed), host));
      if (repository === undefined) return yield* bail(`--repo ${typed} is not a git repository`);
    }
    const inputs: TidyInputs = {
      home,
      worktreeRoot: agentWorktreeRoot(home, process.env),
      scratchRoot: scratchRoot(home),
      ...(repository === undefined ? {} : { repo: repository }),
    };

    const plan = yield* Effect.promise(() => planTidy(inputs, host));
    for (const action of plan.actions) {
      yield* Console.log(`${actionVerb(action)} ${actionSubject(action)}: ${action.reason}`);
    }
    for (const kept of plan.kept) yield* Console.log(`keep ${kept.subject}: ${kept.reason}`);
    for (const note of plan.notes) yield* Console.log(`note: ${note}`);

    if (plan.actions.length === 0) {
      yield* Console.log("Nothing to tidy.");
    } else if (config.apply) {
      const outcome = yield* Effect.promise(() => applyTidy(plan, inputs, host));
      for (const line of outcome.lines) yield* Console.log(line);
      if (outcome.failures > 0) {
        yield* Effect.sync(() => {
          process.exitCode = 1;
        });
      }
    } else {
      // In --repo mode a bare `tidy --apply` would perform a different plan.
      const applyCommand =
        repository === undefined
          ? "docks-kit tidy --apply"
          : `docks-kit tidy --repo ${repository} --apply`;
      yield* Console.log(
        `Dry run: ${plan.actions.length} actions. Run '${applyCommand}' to perform them.`,
      );
    }

    if (config.report) {
      const sections = yield* Effect.promise(() => buildTidyReport(inputs, host, plan.docker));
      for (const section of sections) {
        yield* Console.log(`== ${section.title}`);
        for (const line of section.lines) yield* Console.log(line);
      }
    }
  }),
).pipe(
  Command.withDescription(
    "List or remove safe agent leftovers (merged idle worktrees, their containers, orphaned processes in agent directories, idle scratch directories); --report lists other disk and memory use.",
  ),
);
