import { Argument, Command } from "effect/cli";
import { Effect } from "effect";

import { runPlan } from "../plan/commands";
import { PlanServicesLive } from "../plan/services";

// `argv.ts` puts a `--` after the `plan` word, so every later word reaches the plan dispatcher as it was given, and
// the dispatcher refuses an unknown argument with the words of the plan contract.
const args: Argument.Argument<ReadonlyArray<string>> = Argument.String("args").pipe(
  Argument.withDescription(
    "new|show|export|edit|status|step|list|archive|retire|reopen|base-blob|checkout-state and their arguments",
  ),
  Argument.variadic(),
);

export const planCommand = Command.make("plan", { args }, (config) =>
  runPlan(config.args).pipe(
    Effect.flatMap((code) =>
      Effect.sync(() => {
        process.exitCode = code;
      }),
    ),
    Effect.provide(PlanServicesLive),
  ),
).pipe(
  Command.withDescription(
    "Plan lifecycle helper of the plan-manager skill: GitHub plan issues, plan exports and edits, and checkout snapshots.",
  ),
);
