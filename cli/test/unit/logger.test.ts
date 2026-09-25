import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import { makeLogger, writeIgnoringEpipe } from "../../src/engine-native/logger";

describe("logger progress channel", () => {
  it("keeps only one transient line visible", () => {
    const chunks: Array<string> = [];
    const logger = makeLogger({ progress: (chunk) => void chunks.push(chunk) });

    logger.clearProgress();

    logger.progress("Claude");
    logger.progress("Codex");
    logger.clearProgress();
    logger.clearProgress();

    expect(chunks).toEqual([
      "\r\x1b[2K\x1b[2mClaude\x1b[0m",
      "\r\x1b[2K\x1b[2mCodex\x1b[0m",
      "\r\x1b[2K",
    ]);
  });

  it("clears a transient status before writing a durable change", () => {
    const writes: Array<string> = [];
    const logger = makeLogger({
      progress: (chunk) => void writes.push(`progress:${chunk}`),
      stderr: (chunk) => void writes.push(`stderr:${chunk}`),
    });

    logger.progress("Refreshing plugins...");
    logger.change("Plugins synced");

    expect(writes).toEqual([
      "progress:\r\x1b[2K\x1b[2mRefreshing plugins...\x1b[0m",
      "progress:\r\x1b[2K",
      "stderr:\x1b[1;32m[ok]\x1b[0m Plugins synced\n",
    ]);
  });

  it("keeps progress silent when only a durable stderr sink is injected", () => {
    const chunks: Array<string> = [];
    const logger = makeLogger({ stderr: (chunk) => void chunks.push(chunk) });

    logger.progress("Refreshing plugins...");

    expect(chunks).toEqual([]);
  });
});

describe("logger terminal lease", () => {
  it("serializes terminal-exclusive sections and suspends progress redraw", async () => {
    const chunks: Array<string> = [];
    const events: Array<string> = [];
    let enterFirst!: () => void;
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      enterFirst = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const logger = makeLogger({ progress: (chunk) => void chunks.push(chunk) });
    const lease = logger.acquireTerminal("Syncing Claude, Codex...");

    const first = lease.withExclusive(async () => {
      events.push("first:start");
      enterFirst();
      await firstGate;
      events.push("first:finish");
    });
    const second = lease.withExclusive(() => {
      events.push("second:start");
      events.push("second:finish");
    });
    await firstEntered;
    lease.update("Syncing Codex...");
    logger.progress("pipeline-owned progress");

    expect(chunks).toEqual(["\r\x1b[2K\x1b[2mSyncing Claude, Codex...\x1b[0m", "\r\x1b[2K"]);
    expect(events).toEqual(["first:start"]);

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:finish", "second:start", "second:finish"]);
    expect(chunks).toEqual([
      "\r\x1b[2K\x1b[2mSyncing Claude, Codex...\x1b[0m",
      "\r\x1b[2K",
      "\r\x1b[2K\x1b[2mSyncing Codex...\x1b[0m",
    ]);

    lease.release();
    expect(chunks.at(-1)).toBe("\r\x1b[2K");
  });

  it("rejects nested terminal-exclusive sections and accepts the next section", async () => {
    const logger = makeLogger({});
    const lease = logger.acquireTerminal("Syncing...");

    await expect(
      lease.withExclusive(async () => {
        await lease.withExclusive(() => {});
      }),
    ).rejects.toThrow("terminal lease withExclusive cannot be re-entered");
    await expect(lease.withExclusive(() => "continued")).resolves.toBe("continued");

    lease.release();
  });

  it("buffers durable output during an exclusive section and flushes it in call order", async () => {
    const writes: Array<string> = [];
    let entered!: () => void;
    let finish!: () => void;
    const actionEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const actionGate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const logger = makeLogger({
      progress: (chunk) => void writes.push(`progress:${chunk}`),
      stderr: (chunk) => void writes.push(`stderr:${chunk}`),
      stdout: (chunk) => void writes.push(`stdout:${chunk}`),
    });
    const lease = logger.acquireTerminal("Syncing Claude, Codex...");

    const exclusive = lease.withExclusive(async () => {
      logger.change("Claude changed");
      logger.echo("Codex summary");
      logger.warn("skills warning");
      logger.verbose("Claude steady");
      logger.err("failure now");
      entered();
      await actionGate;
    });
    await actionEntered;

    expect(writes).toEqual([
      "progress:\r\x1b[2K\x1b[2mSyncing Claude, Codex...\x1b[0m",
      "progress:\r\x1b[2K",
      "stderr:\x1b[1;31m[err]\x1b[0m failure now\n",
    ]);

    finish();
    await exclusive;
    expect(writes).toEqual([
      "progress:\r\x1b[2K\x1b[2mSyncing Claude, Codex...\x1b[0m",
      "progress:\r\x1b[2K",
      "stderr:\x1b[1;31m[err]\x1b[0m failure now\n",
      "stderr:\x1b[1;32m[ok]\x1b[0m Claude changed\n",
      "stdout:Codex summary\n",
      "stderr:\x1b[1;33m[warn]\x1b[0m skills warning\n",
      "stderr:\x1b[1;32m[ok]\x1b[0m Claude steady\n",
      "progress:\r\x1b[2K\x1b[2mSyncing Claude, Codex...\x1b[0m",
    ]);

    lease.release();
  });

  it("flushes durable output and restores progress when exclusive work fails", async () => {
    const writes: Array<string> = [];
    const logger = makeLogger({
      progress: (chunk) => void writes.push(`progress:${chunk}`),
      stderr: (chunk) => void writes.push(`stderr:${chunk}`),
    });
    const lease = logger.acquireTerminal("Syncing...");

    await expect(
      lease.withExclusive(() => {
        logger.change("Saved");
        throw new Error("install failed");
      }),
    ).rejects.toThrow("install failed");
    expect(writes).toEqual([
      "progress:\r\x1b[2K\x1b[2mSyncing...\x1b[0m",
      "progress:\r\x1b[2K",
      "stderr:\x1b[1;32m[ok]\x1b[0m Saved\n",
      "progress:\r\x1b[2K\x1b[2mSyncing...\x1b[0m",
    ]);

    lease.release();
  });

  it("returns transient progress control after the terminal lease is released", () => {
    const chunks: Array<string> = [];
    const logger = makeLogger({ progress: (chunk) => void chunks.push(chunk) });
    const lease = logger.acquireTerminal("Syncing...");

    logger.progress("ignored");
    logger.clearProgress();
    expect(() => logger.acquireTerminal("Another sync")).toThrow("terminal lease already acquired");
    expect(chunks).toEqual(["\r\x1b[2K\x1b[2mSyncing...\x1b[0m"]);

    lease.release();
    logger.progress("Done");
    logger.clearProgress();
    expect(chunks).toEqual([
      "\r\x1b[2K\x1b[2mSyncing...\x1b[0m",
      "\r\x1b[2K",
      "\r\x1b[2K\x1b[2mDone\x1b[0m",
      "\r\x1b[2K",
    ]);
  });
});

describe("closed downstream reader", () => {
  const epipe = (): NodeJS.ErrnoException =>
    Object.assign(new Error("broken pipe"), { code: "EPIPE" });

  it("continues writing after a synchronous EPIPE", () => {
    const writes: Array<string> = [];
    let closed = true;
    const stream = {
      write: (chunk: string) => {
        if (closed) throw epipe();
        writes.push(chunk);
      },
    };

    writeIgnoringEpipe(stream, "skipped\n");
    closed = false;
    writeIgnoringEpipe(stream, "retained\n");

    expect(writes).toEqual(["retained\n"]);
  });

  it("keeps the stream usable after an asynchronous EPIPE", () => {
    const writes: Array<string> = [];
    const stream = Object.assign(new EventEmitter(), {
      write: (chunk: string) => void writes.push(chunk),
    });

    writeIgnoringEpipe(stream, "before\n");
    stream.emit("error", epipe());
    writeIgnoringEpipe(stream, "after\n");

    expect(writes).toEqual(["before\n", "after\n"]);
  });

  it("propagates a synchronous write failure other than EPIPE", () => {
    const failure = new Error("disk full");
    const stream = {
      write: () => {
        throw failure;
      },
    };

    expect(() => writeIgnoringEpipe(stream, "row\n")).toThrow(failure);
  });

  it("propagates an asynchronous stream failure other than EPIPE", () => {
    const stream = Object.assign(new EventEmitter(), { write: () => true });
    writeIgnoringEpipe(stream, "before\n");
    const failure = new Error("disk full");

    expect(() => stream.emit("error", failure)).toThrow(failure);
  });
});
