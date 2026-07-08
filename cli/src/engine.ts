import { Command as Subprocess } from "@effect/platform"
import { Console, Effect } from "effect"
import { kitHome } from "./kitHome"

/**
 * The single seam between the typed CLI and the bash engine. All mutation runs
 * through lib/engine.sh (same flag vocabulary as this CLI), so the engine stays
 * independently usable as the zero-dependency escape hatch.
 */
export const engine = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const code = yield* Subprocess.make("bash", join("lib/engine.sh"), ...args).pipe(
      Subprocess.workingDirectory(kitHome()),
      Subprocess.stdin("inherit"),
      Subprocess.stdout("inherit"),
      Subprocess.stderr("inherit"),
      Subprocess.exitCode
    )
    if (code !== 0) {
      yield* Effect.sync(() => process.exit(code))
    }
  })

/** Run the engine capturing stdout (engine logs/warns go to stderr and pass through). */
export const engineCapture = (args: ReadonlyArray<string>) =>
  Subprocess.make("bash", join("lib/engine.sh"), ...args).pipe(
    Subprocess.workingDirectory(kitHome()),
    Subprocess.stderr("inherit"),
    Subprocess.string
  )

const join = (rel: string): string => `${kitHome()}/${rel}`

/** Print a message to stderr and exit — for CLI-side validation failures. */
export const bail = (message: string, code = 2) =>
  Console.error(message).pipe(Effect.andThen(Effect.sync(() => process.exit(code))))
