import { Command, Prompt } from "effect/unstable/cli"
import { Console, Effect } from "effect"
import { bail } from "../engine"
import {
  engineHome,
  HARNESSES,
  harnessStateFile,
  LEGACY_SELECTION,
  readHarnessSelection,
  writeHarnessSelection,
  type Harness
} from "../engine-native/harnesses"

const DESCRIPTIONS: Record<Harness, string> = {
  claude: "Claude Code user configuration",
  codex: "Codex user configuration",
  agents: "universal agent skills",
  omp: "Oh My Pi user configuration"
}

export const harnessesCommand = Command.make(
  "harnesses",
  {},
  () =>
    Effect.gen(function* () {
      const home = engineHome(process.env)
      const stored = yield* Effect.sync(() => readHarnessSelection(home))
      const selection = stored ?? LEGACY_SELECTION
      const names = selection.join(", ")

      if (stored === undefined) {
        yield* Console.log(
          `Harness selection: ${names} (no selection is stored yet; the legacy default applies)`
        )
      } else {
        yield* Console.log(`Harness selection: ${names}`)
      }

      if (!process.stdout.isTTY) return

      const answer = yield* Prompt.multiSelect({
        message: "Choose the harnesses for a flag-less docks-kit sync",
        choices: HARNESSES.map((harness) => ({
          title: harness,
          value: harness,
          description: DESCRIPTIONS[harness],
          selected: selection.includes(harness)
        }))
      })

      if (answer.length === 0) {
        return yield* bail("Select at least one harness. The stored selection was not changed.")
      }

      yield* Effect.sync(() => writeHarnessSelection(home, answer))
      yield* Console.log(
        `Saved harness selection: ${answer.join(", ")} (${harnessStateFile(home)})`
      )
    })
).pipe(
  Command.withDescription(
    "Choose the harness selection that drives a flag-less docks-kit sync."
  )
)
