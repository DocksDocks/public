import { tmpdir } from "node:os";

import { Argument, Command } from "effect/unstable/cli";
import { Console, Effect } from "effect";

import { bail } from "../engine";
import { engineHome } from "../engine-native/harnesses";
import {
  allowedRemovalRoots,
  createScratchDir,
  removeTemporaryPath,
  scratchRoot,
} from "../engine-native/scratch";

const action = Argument.String("action").pipe(
  Argument.withDescription("new <label> | remove <path>..."),
);
const operands: Argument.Argument<ReadonlyArray<string>> = Argument.String("operands").pipe(
  Argument.withDescription("The label for new, or the paths for remove"),
  Argument.variadic(),
);

export const scratchCommand = Command.make("scratch", { action, operands }, (config) =>
  Effect.gen(function* () {
    const home = engineHome();
    switch (config.action) {
      case "new": {
        const [label, ...rest] = config.operands;
        if (label === undefined || rest.length > 0)
          return yield* bail("scratch new needs one label");
        let created: string;
        try {
          created = createScratchDir(scratchRoot(home), label);
        } catch (cause) {
          return yield* bail(cause instanceof Error ? cause.message : String(cause));
        }
        yield* Console.log(created);
        return;
      }
      case "remove": {
        if (config.operands.length === 0) {
          return yield* bail("scratch remove needs at least one path");
        }
        const roots = allowedRemovalRoots({
          home,
          scratch: scratchRoot(home),
          tmp: tmpdir(),
          platform: process.platform,
        });
        let refused = false;
        for (const operand of config.operands) {
          const outcome = removeTemporaryPath(operand, roots, home);
          if (outcome.kind === "removed") {
            yield* Console.log(`removed ${outcome.path}`);
          } else {
            refused = true;
            yield* Console.log(`refused ${outcome.path}: ${outcome.reason}`);
          }
        }
        if (refused) {
          yield* Effect.sync(() => {
            process.exitCode = 1;
          });
        }
        return;
      }
      default:
        return yield* bail(`Unknown scratch action '${config.action}'; use new or remove`);
    }
  }),
).pipe(
  Command.withDescription(
    "Create an agent temporary directory, or remove agent temporary files and directories; removal accepts only paths inside the scratch root, the system temporary directory, or /var/tmp.",
  ),
);
