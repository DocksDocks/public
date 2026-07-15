import { Args, Command, Options } from "@effect/cli"
import { Console, Effect, Option } from "effect"
import { bail } from "../engine"
import { modelCatalog, type Tool } from "../manifests"
import { workflowCatalog, workflowRegistryJson } from "../workflowModels"

const tool = Args.text({ name: "tool" }).pipe(
  Args.withDescription("claude | codex | workflow (omit for both tool catalogs)"),
  Args.optional
)
const json = Options.boolean("json").pipe(
  Options.withDescription("Machine-readable output")
)

const renderTool = (t: Tool) =>
  Effect.gen(function* () {
    const catalog = modelCatalog(t)
    yield* Console.log(`${t} models (kit-verified ${catalog.verified}):`)
    for (const m of catalog.models) {
      yield* Console.log(`  ${m.id.padEnd(28)} ${m.kind.padEnd(6)} ${m.note ?? ""}`)
    }
    yield* Console.log("")
  })

export const modelsCommand = Command.make("models", { tool, json }, (config) =>
  Effect.gen(function* () {
    const requested = Option.getOrUndefined(config.tool)
    if (requested === "workflow") {
      return yield* Console.log(config.json ? workflowRegistryJson() : workflowCatalog())
    }
    if (requested !== undefined && requested !== "claude" && requested !== "codex") {
      return yield* bail(`Unknown tool '${requested}' (valid: claude, codex, workflow)`)
    }
    const tools: Array<Tool> = requested !== undefined ? [requested as Tool] : ["claude", "codex"]

    if (config.json) {
      const out = Object.fromEntries(tools.map((t) => [t, modelCatalog(t)]))
      return yield* Console.log(JSON.stringify(out, null, 2))
    }

    for (const t of tools) {
      yield* renderTool(t)
    }
    yield* Console.log(
      "Catalog: SoT/models.json (research-verified). Well-formed IDs outside it apply with a warning."
    )
  })
).pipe(
  Command.withDescription("List kit-verified tool models or the Docks workflow role registry (SoT/models.json).")
)
