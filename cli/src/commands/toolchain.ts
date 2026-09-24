import { Argument, Command, Flag } from "effect/unstable/cli";
import { Effect, Option } from "effect";
import { bail, engine } from "../engine";

const MANAGED = ["bun"];

const op = Argument.String("op").pipe(
  Argument.withDescription("check (default) | ensure <tool> | outdated"),
  Argument.optional,
);
const tool = Argument.String("tool").pipe(
  Argument.withDescription(`Managed tool for ensure: ${MANAGED.join(", ")}`),
  Argument.optional,
);
const verbose = Flag.Boolean("verbose").pipe(
  Flag.withAlias("v"),
  Flag.withDescription("Also print no-op confirmations (present, up to date)"),
  Flag.withDefault(false),
);
const refresh = Flag.Boolean("refresh").pipe(
  Flag.withDescription("outdated: bypass the 24 h cache"),
  Flag.withDefault(false),
);

export const toolchainCommand = Command.make(
  "toolchain",
  { op, tool, verbose, refresh },
  (config) =>
    Effect.gen(function* () {
      const operation = Option.getOrElse(config.op, () => "check");
      const flags = config.verbose ? ["--verbose"] : [];

      switch (operation) {
        case "check":
          return yield* engine(["toolchain", "check", ...(config.verbose ? ["--verbose"] : [])]);
        case "ensure": {
          const t = Option.getOrUndefined(config.tool);
          if (t === undefined || !MANAGED.includes(t)) {
            return yield* bail(`toolchain ensure needs a managed tool: ${MANAGED.join(", ")}`);
          }
          return yield* engine(["toolchain", "ensure", t, ...flags]);
        }
        case "outdated":
          return yield* engine(["toolchain", "outdated", ...(config.refresh ? ["--refresh"] : [])]);
        default:
          return yield* bail(
            `Unknown toolchain op '${operation}' (valid: check, ensure, outdated)`,
          );
      }
    }),
).pipe(
  Command.withDescription(
    "Verified-version floors for external tools (SoT/toolchain.json): check prints the doctor table; ensure installs one managed tool when it is missing; outdated compares verified pins with the newest upstream release (network, report only).",
  ),
);
