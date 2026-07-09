import { Console, Effect } from "effect"
import { spawnSync } from "node:child_process"
import { runEngineNative } from "./engine-native"
import { makeEngineServices } from "./engine-native/services"
import { kitHome } from "./kitHome"

// Same factory as the Effect rim's live layers — this path runs outside the
// runtime (child-spawn capture), so it takes the services directly.
const services = makeEngineServices()

/**
 * The single seam between the typed CLI and EngineNative. Engine execution
 * stays in-process after @effect/cli has parsed pickers and flag spellings.
 */
const bashRemovedMessage = "bash engine removed — recover at tag bash-engine-final"
const bashEngineRequested = (): boolean => process.env["DOCKS_KIT_ENGINE"] === "bash"

// bun build --compile runs the embedded entry from a virtual path
// ("/$bunfs/root/…" on POSIX, "B:\~BUN\root\…" on Windows). There
// process.execPath IS the CLI, so a re-spawn must not pass main.ts.
// The Windows check is anchored to the drive-rooted "~BUN" segment so a
// real checkout under a ~BUN-named directory can't false-positive.
export const compiled =
  process.argv[1] !== undefined &&
  (process.argv[1].startsWith("/$bunfs/") || /^[A-Za-z]:[\\/]~BUN[\\/]/i.test(process.argv[1]))

export const engine = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (bashEngineRequested()) {
      yield* bail(bashRemovedMessage, 2)
    }
    const code = yield* Effect.sync(() => runEngineNative(args))
    if (code !== 0) {
      yield* Effect.sync(() => process.exit(code))
    }
  })

/** Run the engine capturing stdout (engine logs/warns go to stderr and pass through). */
export const engineCapture = (args: ReadonlyArray<string>) =>
  bashEngineRequested()
    ? bail(bashRemovedMessage, 2)
    : Effect.sync(() => {
      // Child process (raw channel): runEngineNative writes straight to
      // process.stdout, so in-process capture isn't possible.
      const res = spawnSync(process.execPath, compiled ? [...args] : [`${kitHome()}/cli/src/main.ts`, ...args], {
        env: { ...process.env, DOCKS_KIT_ENGINE: "native-raw" },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"]
      })
      if (res.error !== undefined || res.status !== 0) {
        services.logger.warn(`engine capture failed (${args.join(" ")} exited ${res.status ?? "spawn-error"})`)
      }
      return res.stdout ?? ""
    })

/** Print a message to stderr and exit — for CLI-side validation failures. */
export const bail = (message: string, code = 2) =>
  Console.error(message).pipe(Effect.andThen(Effect.sync(() => process.exit(code))))
