import { Args, Command, Options, Prompt } from "@effect/cli"
import { Effect, Option } from "effect"
import { bail, engine } from "../engine"
import { modelCatalog, type Tool } from "../manifests"

const tool = Args.text({ name: "tool" }).pipe(
  Args.withDescription("Which tool: claude | codex")
)
const value = Args.text({ name: "value" }).pipe(
  Args.withDescription("Model to set (omit to view current + pick interactively on a TTY)"),
  Args.optional
)
const dryRun = Options.boolean("dry-run").pipe(
  Options.withDescription("Preview without applying")
)
const verbose = Options.boolean("verbose").pipe(
  Options.withAlias("v"),
  Options.withDescription("Also print no-op confirmations (already in sync, up to date)")
)

const KEEP = "__keep__"

export const modelCommand = Command.make(
  "model",
  { tool, value, dryRun, verbose },
  (config) =>
    Effect.gen(function* () {
      if (config.tool !== "claude" && config.tool !== "codex") {
        return yield* bail(`Unknown tool '${config.tool}' (valid: claude, codex)`)
      }
      const t = config.tool as Tool
      const dry = [...(config.dryRun ? ["--dry-run"] : []), ...(config.verbose ? ["--verbose"] : [])]

      if (Option.isSome(config.value)) {
        return yield* engine(["model", t, config.value.value, ...dry])
      }

      // No value: show current (engine prints deployed + SoT + catalog) …
      yield* engine(["model", t, ...(config.verbose ? ["--verbose"] : [])])

      // … and offer an interactive picker when attached to a terminal.
      if (!process.stdin.isTTY || !process.stdout.isTTY) return

      const catalog = modelCatalog(t)
      const chosen = yield* Prompt.select({
        message: `Set the deployed ${t} model (deployed config only; a flag-less sync reverts to SoT)`,
        choices: [
          { title: "(keep current)", value: KEEP },
          ...catalog.models.map((m) => ({
            title: m.id,
            value: m.id,
            description: m.note ?? ""
          }))
        ]
      })
      if (chosen !== KEEP) {
        yield* engine(["model", t, chosen, ...dry])
      }
    })
).pipe(
  Command.withDescription(
    "Get or set the DEPLOYED model for one tool without a full sync (deploy-time modifier semantics: SoT untouched; flag-less sync reverts)."
  )
)
