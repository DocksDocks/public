import { Command as Subprocess } from "@effect/platform"
import { Console, Effect } from "effect"
import { spawnSync } from "node:child_process"
import { runEngineNative } from "./engine-native"
import { kitHome } from "./kitHome"

/**
 * The single seam between the typed CLI and the engine. `DOCKS_KIT_ENGINE=
 * native` routes to EngineNative (in-process) AFTER @effect/cli has parsed —
 * pickers, `--flag value` forms, and non-engine commands stay intact; the
 * default runs lib/engine.sh, which also stays independently usable as the
 * zero-dependency escape hatch. Step 6 flips the default here, nowhere else.
 */
const nativeSelected = (): boolean => process.env["DOCKS_KIT_ENGINE"] === "native"

export const engine = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const code = nativeSelected()
      ? yield* Effect.sync(() => runEngineNative(args))
      : yield* Subprocess.make("bash", join("lib/engine.sh"), ...args).pipe(
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
  nativeSelected()
    ? Effect.sync(() => {
        // Child process (raw channel): runEngineNative writes straight to
        // process.stdout, so in-process capture isn't possible.
        const res = spawnSync(process.execPath, [`${kitHome()}/cli/src/main.ts`, ...args], {
          env: { ...process.env, DOCKS_KIT_ENGINE: "native-raw" },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "inherit"]
        })
        return res.stdout ?? ""
      })
    : Subprocess.make("bash", join("lib/engine.sh"), ...args).pipe(
        Subprocess.workingDirectory(kitHome()),
        Subprocess.stderr("inherit"),
        Subprocess.string
      )

const join = (rel: string): string => `${kitHome()}/${rel}`

/** Print a message to stderr and exit — for CLI-side validation failures. */
export const bail = (message: string, code = 2) =>
  Console.error(message).pipe(Effect.andThen(Effect.sync(() => process.exit(code))))
