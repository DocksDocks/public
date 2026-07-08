import { Args, Command, Options } from "@effect/cli"
import { Console, Effect, Option } from "effect"
import { bail } from "../engine"
import { skillsView } from "../manifests"

const action = Args.text({ name: "action" }).pipe(
  Args.withDescription("list (default)"),
  Args.optional
)
const json = Options.boolean("json").pipe(
  Options.withDescription("Machine-readable output")
)

export const skillsCommand = Command.make("skills", { action, json }, (config) =>
  Effect.gen(function* () {
    const act = Option.getOrElse(config.action, () => "list")
    if (act !== "list") {
      return yield* bail(
        `Unknown skills action '${act}' (valid: list). Declare skills in SoT/.agents/skills.txt and run sync; --prune removes undeclared kit-managed ones.`
      )
    }
    const view = skillsView()
    if (config.json) {
      return yield* Console.log(JSON.stringify(view, null, 2))
    }
    yield* Console.log(`${"SKILL".padEnd(28)} ${"DECLARED".padEnd(9)} ${"INSTALLED".padEnd(10)} CLAUDE-SYMLINK`)
    for (const s of view) {
      yield* Console.log(
        `${s.skill.padEnd(28)} ${(s.declared ? "yes" : "no").padEnd(9)} ${(s.installed ? "yes" : "no").padEnd(10)} ${s.claudeSymlink ? "ok" : "-"}`
      )
    }
  })
).pipe(
  Command.withDescription(
    "Universal agent skills: SoT/.agents/skills.txt vs ~/.agents/skills + the ~/.claude/skills symlink health (read-only)."
  )
)
