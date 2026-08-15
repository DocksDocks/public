import { CliError } from "effect/unstable/cli"
import { Console, Effect } from "effect"
import { spawnSync } from "node:child_process"
import { runEngineNative } from "./engine-native"
import { ExitError } from "./engine-native/parseArgs"
import { makeEngineServices } from "./engine-native/services"
import { targetForHost } from "./engine-native/os/targets"
import { kitHome } from "./kitHome"
import { DependencyManagerService, LoggerService, PlatformService } from "./services"

/**
 * The single seam between the typed CLI and EngineNative. Engine execution
 * stays in-process after effect/unstable/cli has parsed pickers and flag spellings.
 */
const bashRemovedMessage = "bash engine removed — recover at tag bash-engine-final"
const bashEngineRequested = (): boolean => process.env["DOCKS_KIT_ENGINE"] === "bash"
const requireSupportedHost = () => {
  const platform = process.platform
  const arch = process.arch
  return targetForHost(platform, arch) !== undefined
    ? Effect.void
    : bail(
      `unsupported host ${platform}/${arch}; docks-kit supports only Linux, macOS, and Windows on x64 or arm64`,
      2
    )
}

// bun build --compile runs the embedded entry from a virtual POSIX path
// ("/$bunfs/root/…"). There process.execPath IS the CLI, so a re-spawn must
// not pass main.ts.
export const compiled =
  process.argv[1] !== undefined && process.argv[1].startsWith("/$bunfs/")

export class EngineCaptureError extends ExitError {
  constructor(readonly diagnostic: string, code: number) {
    super(code)
    this.name = "EngineCaptureError"
    this.message = diagnostic
  }
}

const failureMessage = (error: unknown): string => {
  if (error instanceof Error && error.message !== "") return error.message
  return typeof error === "string" && error !== "" ? error : "unknown error"
}

export const engine = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    yield* requireSupportedHost()
    if (bashEngineRequested()) {
      yield* bail(bashRemovedMessage, 2)
    }
    const logger = yield* LoggerService
    const deps = yield* DependencyManagerService
    const platform = yield* PlatformService
    const code = yield* Effect.tryPromise({
      try: () => runEngineNative(args, { logger, deps, platform }),
      catch: (error) => new CliError.UserError({
        cause: error,
        userMessage: `engine operation '${args.join(" ") || "default"}' failed: ${failureMessage(error)}`
      })
    })
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
    const res = yield* Effect.sync(() =>
      // Child process (raw channel): runEngineNative writes straight to
      // process.stdout, so in-process capture is not possible.
      spawnSync(process.execPath, compiled ? [...args] : [`${kitHome()}/cli/src/main.ts`, ...args], {
        env: { ...process.env, DOCKS_KIT_ENGINE: "native-raw" },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"]
      })
    )
    if (res.error !== undefined || res.status !== 0) {
      const reasons = new Array<string>()
      if (typeof res.status === "number") reasons.push(`exit ${res.status}`)
      if (res.signal !== null) reasons.push(`signal ${res.signal}`)
      if (res.error !== undefined) reasons.push(`spawn error: ${res.error.message}`)
      if (reasons.length === 0) reasons.push("no child status")
      const diagnostic = `engine capture failed for '${args.join(" ") || "default"}': ${reasons.join("; ")}`
      makeEngineServices().logger.err(diagnostic)
      const code = typeof res.status === "number" && res.status !== 0 ? res.status : 1
      return yield* Effect.fail(new EngineCaptureError(diagnostic, code))
    }
    return res.stdout ?? ""
  })

/** Print a message to stderr and exit — for CLI-side validation failures. */
export const bail = (message: string, code = 2) =>
  Console.error(message).pipe(Effect.andThen(Effect.sync(() => process.exit(code))))
