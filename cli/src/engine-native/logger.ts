/**
 * Leveled stderr logger + stdout data writer — the Output Policy contract in
 * DESIGN.md. Filtering is explicit and synchronous: engine code is imperative,
 * so fiber-scoped Effect log levels cannot see these writes. The prefixes and
 * ANSI codes are stable golden surface; the level controls visibility only.
 */

export interface Logger {
  /** `[ok]` green — an operation actually mutated something. Always visible. */
  readonly change: (msg: string) => void
  /** `[ok]` green — status-quo confirmation; visible only with verbosity on. */
  readonly verbose: (msg: string) => void
  readonly warn: (msg: string) => void
  readonly err: (msg: string) => void
  /** stdout data line (dry-run report, summary, usage) — never filtered. */
  readonly echo: (line: string) => void
}

export interface LoggerSinks {
  readonly isVerbose?: () => boolean
  readonly stderr?: (chunk: string) => void
  readonly stdout?: (chunk: string) => void
}

export function makeLogger(sinks: LoggerSinks): Logger {
  const errWrite = sinks.stderr ?? ((chunk: string) => void process.stderr.write(chunk))
  const outWrite = sinks.stdout ?? ((chunk: string) => void process.stdout.write(chunk))
  const ok = (msg: string): void => errWrite(`\x1b[1;32m[ok]\x1b[0m ${msg}\n`)
  return {
    change: ok,
    verbose: (msg) => {
      if (sinks.isVerbose?.() === true) ok(msg)
    },
    warn: (msg) => errWrite(`\x1b[1;33m[warn]\x1b[0m ${msg}\n`),
    err: (msg) => errWrite(`\x1b[1;31m[err]\x1b[0m ${msg}\n`),
    echo: (line) => outWrite(`${line}\n`)
  }
}
