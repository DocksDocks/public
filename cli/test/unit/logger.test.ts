import { describe, expect, it } from "vitest"

import { makeLogger, writeIgnoringEpipe } from "../../src/engine-native/logger"

describe("logger progress channel", () => {
  it("writes a transient status to an injected progress sink", () => {
    const chunks: Array<string> = []
    const logger = makeLogger({ progress: (chunk) => void chunks.push(chunk) })

    logger.progress("Refreshing plugins...")

    expect(chunks).toEqual(["\r\x1b[2K\x1b[2mRefreshing plugins...\x1b[0m"])
  })

  it("clears a transient status before writing a durable change", () => {
    const writes: Array<string> = []
    const logger = makeLogger({
      progress: (chunk) => void writes.push(`progress:${chunk}`),
      stderr: (chunk) => void writes.push(`stderr:${chunk}`)
    })

    logger.progress("Refreshing plugins...")
    logger.change("Plugins synced")

    expect(writes).toEqual([
      "progress:\r\x1b[2K\x1b[2mRefreshing plugins...\x1b[0m",
      "progress:\r\x1b[2K",
      "stderr:\x1b[1;32m[ok]\x1b[0m Plugins synced\n"
    ])
  })

  it("does not clear when no transient status is pending", () => {
    const chunks: Array<string> = []
    const logger = makeLogger({ progress: (chunk) => void chunks.push(chunk) })

    logger.clearProgress()

    expect(chunks).toEqual([])
  })

  it("keeps progress silent when only a durable stderr sink is injected", () => {
    const chunks: Array<string> = []
    const logger = makeLogger({ stderr: (chunk) => void chunks.push(chunk) })

    logger.progress("Refreshing plugins...")

    expect(chunks).toEqual([])
  })
})

describe("closed downstream reader", () => {
  const epipe = (): NodeJS.ErrnoException => Object.assign(new Error("broken pipe"), { code: "EPIPE" })

  it("ignores a synchronous EPIPE from the stream", () => {
    const stream = {
      write: () => {
        throw epipe()
      }
    }

    expect(() => writeIgnoringEpipe(stream, "row\n")).not.toThrow()
  })

  it("ignores an asynchronous EPIPE emitted by the stream", () => {
    const listeners: Array<(error: unknown) => void> = []
    const stream = {
      write: () => true,
      on: (_event: "error", listener: (error: unknown) => void) => void listeners.push(listener)
    }

    writeIgnoringEpipe(stream, "row\n")

    expect(listeners).toHaveLength(1)
    expect(() => listeners[0]?.(epipe())).not.toThrow()
  })

  it("re-throws a write failure that is not EPIPE", () => {
    const stream = {
      write: () => {
        throw new Error("disk full")
      }
    }

    expect(() => writeIgnoringEpipe(stream, "row\n")).toThrow("disk full")
  })

  it("registers the error listener only once per stream", () => {
    let registrations = 0
    const stream = { write: () => true, on: () => void registrations++ }

    writeIgnoringEpipe(stream, "a\n")
    writeIgnoringEpipe(stream, "b\n")

    expect(registrations).toBe(1)
  })
})
