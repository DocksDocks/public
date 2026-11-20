import { Argument, Command } from "effect/cli";
import { Effect } from "effect";

import { runAgentDocs } from "../agentDocs/commands";
import { AgentDocsServicesLive } from "../agentDocs/services";

// `argv.ts` puts a `--` after the `agent-docs` word, so every later word reaches the agent-docs dispatcher as it was
// given, and each helper refuses an unknown argument with its own usage line.
const args: Argument.Argument<ReadonlyArray<string>> = Argument.String("args").pipe(
  Argument.withDescription(
    "pr-template detect|gate, verify-skill detect|write-gate <path>...|entry-gate, agent-first detect|check|convert-agent <path>, bridge-check audit|verify [--expect <path>]...",
  ),
  Argument.variadic(),
);

export const agentDocsCommand = Command.make("agent-docs", { args }, (config) =>
  runAgentDocs(config.args).pipe(
    Effect.flatMap((code) =>
      Effect.sync(() => {
        process.exitCode = code;
      }),
    ),
    Effect.provide(AgentDocsServicesLive),
  ),
).pipe(
  Command.withDescription(
    "Agent-doc checks of the agent-first-setup, claude-md-migration, and plan-workspace skills: pull-request templates, the verify skill, the agent-first check, and the CLAUDE.md bridge check.",
  ),
);
