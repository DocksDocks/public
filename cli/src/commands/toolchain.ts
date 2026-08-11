import { Argument, Command, Flag } from "effect/unstable/cli"
import { Effect, Option } from "effect"
import { bail, engine } from "../engine"

const MANAGED = ["bun", "effect-solutions"]

const op = Argument.string("op").pipe(
  Argument.withDescription("check (default) | ensure <tool>"),
  Argument.optional
)
const tool = Argument.string("tool").pipe(
  Argument.withDescription(`Managed tool for ensure: ${MANAGED.join(", ")}`),
  Argument.optional
)
const yes = Flag.boolean("yes").pipe(
  Flag.withDescription("Auto-accept above-verified installs")
)
const verbose = Flag.boolean("verbose").pipe(
  Flag.withAlias("v"),
  Flag.withDescription("Also print no-op confirmations (present, up to date)")
)

export const toolchainCommand = Command.make("toolchain", { op, tool, yes, verbose }, (config) =>
  Effect.gen(function* () {
    const operation = Option.getOrElse(config.op, () => "check")
    const flags = [...(config.yes ? ["--yes"] : []), ...(config.verbose ? ["--verbose"] : [])]

    switch (operation) {
      case "check":
        return yield* engine(["toolchain", "check", ...(config.verbose ? ["--verbose"] : [])])
      case "ensure": {
        const t = Option.getOrUndefined(config.tool)
        if (t === undefined || !MANAGED.includes(t)) {
          return yield* bail(`toolchain ensure needs a managed tool: ${MANAGED.join(", ")}`)
        }
        return yield* engine(["toolchain", "ensure", t, ...flags])
      }
      default:
        return yield* bail(`Unknown toolchain op '${operation}' (valid: check, ensure)`)
    }
  })
).pipe(
  Command.withDescription(
    "Verified-version floors for external tools (SoT/toolchain.json): check prints the doctor table; ensure installs/upgrades one managed tool per policy (above-verified versions prompt; --yes accepts)."
  )
)
