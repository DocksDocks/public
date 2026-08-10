/**
 * Leveled stderr logger, transient progress writer, and stdout data writer —
 * the Output Policy contract in DESIGN.md. Filtering is explicit and
 * synchronous: engine code is imperative, so fiber-scoped Effect log levels
 * cannot see these writes. Transient progress is active only through an
 * injected progress sink or an interactive stderr. The prefixes and ANSI codes
 * are stable golden surface; the level controls visibility only.
 */

export interface Logger {
  /** `[ok]` green — an operation actually mutated something. Always visible. */
  readonly change: (msg: string) => void
  /** Dim, transient single-line status for blocking work. */
  readonly progress: (msg: string) => void
  /** Erase a pending transient status line. */
  readonly clearProgress: () => void
  /** `[ok]` green — status-quo confirmation; visible only with verbosity on. */
  readonly verbose: (msg: string) => void
  readonly warn: (msg: string) => void
  readonly err: (msg: string) => void
  /** stdout data line (dry-run report, summary, usage) — never filtered. */
  readonly echo: (line: string) => void
}

export interface LoggerSinks {
  readonly stderr?: (chunk: string) => void
  readonly progress?: (chunk: string) => void
  readonly stdout?: (chunk: string) => void
}

interface WritableStreamLike {
  write: (chunk: string) => unknown
  on?: (event: "error", listener: (error: unknown) => void) => unknown
}

const epipeGuarded = new WeakSet<WritableStreamLike>()

/**
 * A downstream reader may close the pipe early (`docks-kit toolchain check |
 * head`). That is a normal end of consumption, not a CLI failure, so both the
 * synchronous throw and the asynchronous error event are ignored for EPIPE.
 */
export function writeIgnoringEpipe(stream: WritableStreamLike, chunk: string): void {
  if (!epipeGuarded.has(stream)) {
    epipeGuarded.add(stream)
    stream.on?.("error", (error) => {
      if ((error as NodeJS.ErrnoException | null)?.code !== "EPIPE") throw error
    })
  }
  try {
    stream.write(chunk)
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== "EPIPE") throw error
  }
}

export function makeLogger(sinks: LoggerSinks): Logger {
  const errWrite = sinks.stderr ?? ((chunk: string) => writeIgnoringEpipe(process.stderr, chunk))
  const outWrite = sinks.stdout ?? ((chunk: string) => writeIgnoringEpipe(process.stdout, chunk))
  const progressWrite =
    sinks.progress ??
    (sinks.stderr === undefined && process.stderr.isTTY === true
      ? (chunk: string) => writeIgnoringEpipe(process.stderr, chunk)
      : undefined)
  let progressPending = false

  const clearProgress = (): void => {
    if (!progressPending || progressWrite === undefined) return
    progressWrite("\r\x1b[2K")
    progressPending = false
  }
  const ok = (msg: string): void => {
    clearProgress()
    errWrite(`\x1b[1;32m[ok]\x1b[0m ${msg}\n`)
  }
  return {
    change: ok,
    verbose: ok,
    progress: (msg) => {
      if (progressWrite === undefined) return
      progressWrite(`\r\x1b[2K\x1b[2m${msg}\x1b[0m`)
      progressPending = true
    },
    clearProgress,
    warn: (msg) => {
      clearProgress()
      errWrite(`\x1b[1;33m[warn]\x1b[0m ${msg}\n`)
    },
    err: (msg) => {
      clearProgress()
      errWrite(`\x1b[1;31m[err]\x1b[0m ${msg}\n`)
    },
    echo: (line) => {
      clearProgress()
      outWrite(`${line}\n`)
    }
  }
}
