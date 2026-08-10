import { AsyncLocalStorage } from "node:async_hooks"

/**
 * Leveled stderr logger, one run-scoped terminal lease, and stdout data
 * writer — the Output Policy contract in DESIGN.md. Filtering is explicit and
 * synchronous: engine code is imperative, so fiber-scoped Effect log levels
 * cannot see these writes. Transient progress is active only through an
 * injected progress sink or an interactive stderr. The prefixes and ANSI codes
 * are stable golden surface; the level controls visibility only.
 */
export interface TerminalLease {
  /** Replace the coordinator-owned transient line. */
  readonly update: (message: string) => void
  /** Serialize terminal input owners and suspend transient redraw while held. */
  readonly withExclusive: <T>(action: () => T | Promise<T>) => Promise<T>
  /** Clear coordinator progress and return ownership to ordinary progress calls. */
  readonly release: () => void
}


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
  /** Acquire the run-scoped coordinator lease for terminal progress and input. */
  readonly acquireTerminal: (message: string) => TerminalLease
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
  let activeLease: TerminalLease | undefined
  let exclusiveActive = false
  const exclusiveContext = new AsyncLocalStorage<{ active: boolean }>()
  const durableBuffer: Array<() => void> = []


  const eraseProgress = (): void => {
    if (!progressPending || progressWrite === undefined) return
    progressWrite("\r\x1b[2K")
    progressPending = false
  }
  const drawProgress = (message: string): void => {
    if (progressWrite === undefined) return
    progressWrite(`\r\x1b[2K\x1b[2m${message}\x1b[0m`)
    progressPending = true
  }
  const clearProgress = (): void => {
    if (activeLease !== undefined) return
    eraseProgress()
  }
  const writeDurable = (write: () => void): void => {
    if (exclusiveActive) {
      durableBuffer.push(write)
      return
    }
    eraseProgress()
    write()
  }
  const flushDurable = (): void => {
    let firstError: unknown
    while (durableBuffer.length > 0) {
      for (const write of durableBuffer.splice(0)) {
        try {
          write()
        } catch (error) {
          firstError ??= error
        }
      }
    }
    if (firstError !== undefined) throw firstError
  }
  const ok = (msg: string): void => {
    writeDurable(() => errWrite(`\x1b[1;32m[ok]\x1b[0m ${msg}\n`))
  }

  const acquireTerminal = (message: string): TerminalLease => {
    if (activeLease !== undefined) throw new Error("terminal lease already acquired")

    let released = false
    let coordinatorMessage = message
    let exclusiveTail = Promise.resolve()
    let exclusivePending = 0
    const lease: TerminalLease = {
      update: (nextMessage) => {
        if (released) return
        coordinatorMessage = nextMessage
        if (exclusivePending === 0) drawProgress(coordinatorMessage)
      },
      withExclusive: async <T>(action: () => T | Promise<T>): Promise<T> => {
        if (exclusiveContext.getStore()?.active === true) {
          throw new Error("terminal lease withExclusive cannot be re-entered")
        }
        if (released) return await action()
        exclusivePending += 1
        const previous = exclusiveTail
        let unlock!: () => void
        exclusiveTail = new Promise<void>((resolve) => {
          unlock = resolve
        })
        await previous
        eraseProgress()
        exclusiveActive = true
        const owner = { active: true }
        try {
          return await exclusiveContext.run(owner, action)
        } finally {
          owner.active = false
          try {
            flushDurable()
          } finally {
            exclusiveActive = false
            exclusivePending -= 1
            unlock()
            if (!released && exclusivePending === 0) drawProgress(coordinatorMessage)
          }
        }
      },
      release: () => {
        if (released) return
        released = true
        if (activeLease === lease) activeLease = undefined
        eraseProgress()
      }
    }
    activeLease = lease
    drawProgress(coordinatorMessage)
    return lease
  }

  return {
    change: ok,
    verbose: ok,
    progress: (msg) => {
      if (activeLease !== undefined) return
      drawProgress(msg)
    },
    clearProgress,
    warn: (msg) => {
      writeDurable(() => errWrite(`\x1b[1;33m[warn]\x1b[0m ${msg}\n`))
    },
    err: (msg) => {
      eraseProgress()
      errWrite(`\x1b[1;31m[err]\x1b[0m ${msg}\n`)
    },
    echo: (line) => {
      writeDurable(() => outWrite(`${line}\n`))
    },
    acquireTerminal
  }
}
