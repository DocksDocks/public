import { Command as Subprocess } from "@effect/platform"
import { Console, Effect } from "effect"
import { spawnSync } from "node:child_process"
import { runEngineNative } from "./engine-native"
import { kitHome } from "./kitHome"

/**
 * The single seam between the typed CLI and the engine. EngineNative is the
 * default (in-process, routed AFTER @effect/cli has parsed — pickers,
 * `--flag value` forms, and non-engine commands stay intact);
 * `DOCKS_KIT_ENGINE=bash` opts out to lib/engine.sh, which also stays
 * independently usable as the zero-dependency escape hatch.
 */
const nativeSelected = (): boolean => process.env["DOCKS_KIT_ENGINE"] !== "bash"

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
        const res = spawnSync(process.execPath, compiled ? [...args] : [`${kitHome()}/cli/src/main.ts`, ...args], {
          env: { ...process.env, DOCKS_KIT_ENGINE: "native-raw" },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "inherit"]
        })
        if (res.error !== undefined || res.status !== 0) {
          process.stderr.write(`\x1b[1;33m[warn]\x1b[0m engine capture failed (${args.join(" ")} exited ${res.status ?? "spawn-error"})\n`)
        }
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
