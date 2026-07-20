import { Console, Effect } from "effect"
import { spawnSync } from "node:child_process"
import { runEngineNative } from "./engine-native"
import { makeEngineServices } from "./engine-native/services"
import { kitHome } from "./kitHome"
import { DependencyManagerService, LoggerService, PlatformService } from "./services"

/**
 * The single seam between the typed CLI and EngineNative. Engine execution
 * stays in-process after @effect/cli has parsed pickers and flag spellings.
 */
const bashRemovedMessage = "bash engine removed — recover at tag bash-engine-final"
const bashEngineRequested = (): boolean => process.env["DOCKS_KIT_ENGINE"] === "bash"
const requireSupportedHost = () => {
  const platform = process.platform
  const arch = process.arch
  return (platform === "linux" || platform === "darwin") && (arch === "x64" || arch === "arm64")
    ? Effect.void
    : bail(
      `unsupported host ${platform}/${arch}; docks-kit supports only Linux and macOS on x64 or arm64`,
      2
    )
}

// bun build --compile runs the embedded entry from a virtual POSIX path
// ("/$bunfs/root/…"). There process.execPath IS the CLI, so a re-spawn must
// not pass main.ts.
export const compiled =
  process.argv[1] !== undefined && process.argv[1].startsWith("/$bunfs/")

export const engine = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    yield* requireSupportedHost()
    if (bashEngineRequested()) {
      yield* bail(bashRemovedMessage, 2)
    }
    const logger = yield* LoggerService
    const deps = yield* DependencyManagerService
    const platform = yield* PlatformService
    const code = yield* Effect.sync(() => runEngineNative(args, { logger, deps, platform }))
    if (code !== 0) {
      yield* Effect.sync(() => process.exit(code))
    }
  })

/** Run the engine capturing stdout (engine logs/warns go to stderr and pass through). */
export const engineCapture = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    yield* requireSupportedHost()
    if (bashEngineRequested()) {
      return yield* bail(bashRemovedMessage, 2)
    }
    return yield* Effect.sync(() => {
      // Child process (raw channel): runEngineNative writes straight to
      // process.stdout, so in-process capture isn't possible.
      const res = spawnSync(process.execPath, compiled ? [...args] : [`${kitHome()}/cli/src/main.ts`, ...args], {
        env: { ...process.env, DOCKS_KIT_ENGINE: "native-raw" },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"]
      })
      if (res.error !== undefined || res.status !== 0) {
        makeEngineServices().logger.warn(`engine capture failed (${args.join(" ")} exited ${res.status ?? "spawn-error"})`)
      }
      return res.stdout ?? ""
    })
  })

/** Print a message to stderr and exit — for CLI-side validation failures. */
export const bail = (message: string, code = 2) =>
  Console.error(message).pipe(Effect.andThen(Effect.sync(() => process.exit(code))))
