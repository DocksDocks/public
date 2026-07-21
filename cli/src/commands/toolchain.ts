import { Args, Command, Options } from "@effect/cli"
import { Effect, Option } from "effect"
import { bail, engine } from "../engine"

const MANAGED = ["rtk", "bun", "effect-solutions", "agent-browser", "session-relay"]

const op = Args.text({ name: "op" }).pipe(
  Args.withDescription("check (default) | ensure <tool>"),
  Args.optional
)
const tool = Args.text({ name: "tool" }).pipe(
  Args.withDescription(`Managed tool for ensure: ${MANAGED.join(", ")}`),
  Args.optional
)
const yes = Options.boolean("yes").pipe(
  Options.withDescription("Auto-accept above-verified installs")
)
const verbose = Options.boolean("verbose").pipe(
  Options.withAlias("v"),
  Options.withDescription("Also print no-op confirmations (present, up to date)")
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
