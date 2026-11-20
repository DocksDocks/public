/**
 * The dispatcher of `docks-kit agent-docs <helper> <command> [args]`. Each helper prints what its former script
 * printed and returns its exit status; this edge maps each tagged failure to the stderr and stdout lines and the exit
 * status of that script.
 */
import { Effect } from "effect";

import type { FileError, SpawnError } from "../plan/types";
import { type AgentRefusal, type AgentUnreadable, runAgentFirst } from "./agentFirstCheck";
import { runBridgeCheck } from "./bridgeCheck";
import { runPrTemplate } from "./prTemplate";
import { writeStderr, writeStdout } from "./services";
import { UsageError } from "./shared";
import { runVerifySkill } from "./verifySkill";

const USAGE =
  "usage: docks-kit agent-docs pr-template|verify-skill|agent-first|bridge-check <command> [args]";

const HELPERS = {
  "pr-template": runPrTemplate,
  "verify-skill": runVerifySkill,
  "agent-first": runAgentFirst,
  "bridge-check": runBridgeCheck,
} as const;

const isHelper = (word: string | undefined): word is keyof typeof HELPERS =>
  word !== undefined && Object.hasOwn(HELPERS, word);

const printUsage = (error: UsageError): Effect.Effect<number> =>
  writeStderr(`${error.usage}\n`).pipe(Effect.as(1));

const printRefusal = (error: AgentRefusal): Effect.Effect<number> =>
  writeStdout(`ERROR convert-agent ${error.file}: ${error.reason}; port it by hand\n`).pipe(
    Effect.as(2),
  );

const printUnreadable = (error: AgentUnreadable): Effect.Effect<number> =>
  writeStderr(`agent-first-check: cannot read ${error.file} (${error.detail})\n`).pipe(
    Effect.andThen(writeStdout(`ERROR convert-agent ${error.file}: cannot read the file\n`)),
    Effect.as(2),
  );

// The scripts ended with an uncaught exception, exit status 1, when the working folder could not change to the
// repository root or the runtime refused git's arguments.
const printCrash = (error: FileError | SpawnError): Effect.Effect<number> =>
  writeStderr(`agent-docs: ${error.message}\n`).pipe(Effect.as(1));

/** Run `docks-kit agent-docs <args>` and return its exit status. */
export const runAgentDocs = Effect.fn("agentDocs.run")(function* (args: ReadonlyArray<string>) {
  const [helper, ...rest] = args;
  const outcome = isHelper(helper)
    ? HELPERS[helper](rest)
    : Effect.fail(new UsageError({ usage: USAGE }));
  return yield* outcome.pipe(
    Effect.catchTags({
      UsageError: printUsage,
      AgentRefusal: printRefusal,
      AgentUnreadable: printUnreadable,
      FileError: printCrash,
      SpawnError: printCrash,
    }),
  );
});
