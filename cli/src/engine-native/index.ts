/**
 * EngineNative — TypeScript port of lib/engine.sh (windows-support plan,
 * step 5; module map in ./DESIGN.md).
 *
 * Selected by `DOCKS_KIT_ENGINE=native` (cli/src/main.ts bypasses @effect/cli
 * and hands the raw engine argv here, so both engines are exercised through
 * the identical vocabulary the parity harnesses drive). Bash remains the
 * default until step 6 flips it; until a command surface is fully ported,
 * dispatch refuses loudly rather than half-running it.
 */
import { homedir } from "node:os"
import { kitHome } from "../kitHome"
import { modeModel, modeToolchain } from "./modes"
import { err } from "./output"

export interface Ctx {
  readonly repoDir: string
  readonly home: string
  dryRun: boolean
  assumeYes: boolean
}

function makeCtx(): Ctx {
  return {
    repoDir: kitHome(),
    home: process.env["HOME"] !== undefined && process.env["HOME"] !== "" ? process.env["HOME"] : homedir(),
    dryRun: false,
    assumeYes: false
  }
}

export function runEngineNative(argv: ReadonlyArray<string>): number {
  const ctx = makeCtx()
  switch (argv[0]) {
    case "model":
      return modeModel(ctx, argv.slice(1))
    case "toolchain":
      return modeToolchain(ctx, argv.slice(1))
    default:
      err("EngineNative: 'sync' is not ported yet — unset DOCKS_KIT_ENGINE (or set it to 'bash') to use the bash engine")
      return 2
  }
}
