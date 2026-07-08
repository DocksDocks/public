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
import { err } from "./output"

const PORTED: ReadonlyArray<string> = []

export function runEngineNative(argv: ReadonlyArray<string>): number {
  const command = argv[0] ?? "sync"
  if (!PORTED.includes(command)) {
    err(`EngineNative: '${command}' is not ported yet — unset DOCKS_KIT_ENGINE (or set it to 'bash') to use the bash engine`)
    return 2
  }
  return 0
}
