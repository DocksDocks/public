/**
 * Spec for `kitLock.ts` (plan #161, D-A). The module API that these tests use:
 *
 *   interface KitLockOptions {
 *     readonly waitMs: number; // try until now() passes the start + waitMs; 0 tries once, with no sleep
 *     readonly pollMs?: number; // the time between two tries
 *     readonly now?: () => number; // the clock in ms; Date.now by default
 *     readonly sleep?: (ms: number) => Promise<void>; // the wait between two tries
 *   }
 *   type KitLockResult = { kind: "acquired"; lock: KitLock } | { kind: "held" };
 *   acquireKitLock(path: string, options: KitLockOptions): Promise<KitLockResult>;
 *   releaseKitLock(lock: KitLock): void;
 *
 * The lock is an SQLite `BEGIN IMMEDIATE` transaction on `path`. Another
 * connection, in this process or in another process, cannot take it while the
 * holder keeps it. The OS releases it when the holder process ends.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { acquireKitLock, releaseKitLock } from "../../src/engine-native/kitLock";
import { BUN_RUNTIME } from "../lib/cliEntry";
import { SPAWN_TIMEOUT_MS } from "../lib/spawnTimeout";

const LOCK_MODULE = resolve(import.meta.dirname, "../../src/engine-native/kitLock.ts");
const RACERS = 8;
const POSIX = process.platform !== "win32";

const sandboxes: Array<string> = [];
const children: Array<ChildProcessWithoutNullStreams> = [];

function sandbox(): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "kit-lock-")));
  sandboxes.push(base);
  return base;
}

/** Take the lock that no one holds, or fail the test. */
async function take(path: string): Promise<Parameters<typeof releaseKitLock>[0]> {
  const result = await acquireKitLock(path, { waitMs: 0 });
  if (result.kind !== "acquired") throw new Error(`expected a free lock at ${path}`);
  return result.lock;
}

/** Try the lock once, release it when the try took it, and return the result kind. */
async function probe(path: string, waitMs = 0): Promise<string> {
  const result = await acquireKitLock(path, { waitMs });
  if (result.kind === "acquired") releaseKitLock(result.lock);
  return result.kind;
}

afterEach(() => {
  for (const base of sandboxes.splice(0)) rmSync(base, { recursive: true, force: true });
});

afterAll(() => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
});

describe("acquireKitLock in one process", () => {
  it("makes the lock directory and takes a free lock", async () => {
    const base = sandbox();
    const directory = join(base, "cache", "docks-kit");
    const path = join(directory, "test-lock.db");

    const lock = await take(path);
    try {
      expect(statSync(directory).isDirectory()).toBe(true);
      if (POSIX) expect(statSync(directory).mode & 0o777).toBe(0o700);
    } finally {
      releaseKitLock(lock);
    }
  });

  it("refuses a second acquire in the same process while the first holds the lock", async () => {
    const path = join(sandbox(), "test-lock.db");
    const sleeps: Array<number> = [];
    const first = await take(path);

    const second = await acquireKitLock(path, {
      waitMs: 0,
      sleep: async (ms) => void sleeps.push(ms),
    });

    expect(second).toEqual({ kind: "held" });
    expect(sleeps).toEqual([]);
    releaseKitLock(first);
    expect(await probe(path)).toBe("acquired");
  });

  it("returns held when the wait bound ends, with an injected clock", async () => {
    const path = join(sandbox(), "test-lock.db");
    const holder = await take(path);
    let clock = 0;
    const sleeps: Array<number> = [];
    const started = Date.now();

    try {
      const result = await acquireKitLock(path, {
        waitMs: 1_000,
        pollMs: 100,
        now: () => clock,
        sleep: async (ms) => {
          sleeps.push(ms);
          clock += ms;
        },
      });

      expect(result).toEqual({ kind: "held" });
      expect(clock).toBeGreaterThanOrEqual(1_000);
      expect(clock).toBeLessThanOrEqual(1_100);
      expect(sleeps.length).toBeGreaterThan(1);
      for (const ms of sleeps) {
        expect(ms).toBeGreaterThan(0);
        expect(ms).toBeLessThanOrEqual(100);
      }
      // The injected sleep replaces the real wait.
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      releaseKitLock(holder);
    }
  });

  it("takes the lock when the holder releases it during the wait", async () => {
    const path = join(sandbox(), "test-lock.db");
    const holder = await take(path);
    let clock = 0;
    let sleeps = 0;

    const result = await acquireKitLock(path, {
      waitMs: 1_000,
      pollMs: 100,
      now: () => clock,
      sleep: async (ms) => {
        sleeps += 1;
        clock += ms;
        if (sleeps === 3) releaseKitLock(holder);
      },
    });

    expect(result.kind).toBe("acquired");
    expect(clock).toBeLessThan(1_000);
    if (result.kind === "acquired") releaseKitLock(result.lock);
  });
});

/**
 * Each racer loads the lock module, prints `ready`, and waits for `go <ms>` on
 * stdin. It spins until the clock reaches `<ms>`, so that all racers start at
 * the same moment. It then tries the lock with the wait from argv, prints the
 * result kind, and holds a lock that it took until `release`. So no late racer
 * can find the lock free. The module path comes from argv, so the child loads
 * it with `import()`.
 */
const RACER = `
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
const [modulePath, lockPath, waitMs] = process.argv.slice(2);
const { acquireKitLock, releaseKitLock } = await import(pathToFileURL(modulePath).href);
const commands = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
process.stdout.write("ready\\n");
const go = await commands.next();
const startAt = Number(String(go.value).split(" ")[1]);
while (Date.now() < startAt) {}
const result = await acquireKitLock(lockPath, { waitMs: Number(waitMs) });
process.stdout.write(result.kind + "\\n");
await commands.next();
if (result.kind === "acquired") releaseKitLock(result.lock);
process.exit(0);
`;

/** The time from the `go` command to the shared start, so that every racer has read it. */
const START_DELAY_MS = 200;

/**
 * The holder takes the lock inside a function and keeps no reference to the
 * result. It prints the result kind, forces a full garbage collection three
 * times, prints `collected`, and then waits on stdin until the test stops it.
 * The module path comes from argv, so the child loads it with `import()`.
 * The short real sleep between two collections lets pending finalizers run;
 * no fake clock can drive the garbage collector.
 */
const HOLDER = `
import { pathToFileURL } from "node:url";
const [modulePath, lockPath] = process.argv.slice(2);
const { acquireKitLock } = await import(pathToFileURL(modulePath).href);
async function takeAndDrop() {
  const result = await acquireKitLock(lockPath, { waitMs: 0 });
  return result.kind;
}
process.stdout.write((await takeAndDrop()) + "\\n");
for (let round = 0; round < 3; round += 1) {
  Bun.gc(true);
  await Bun.sleep(20);
}
process.stdout.write("collected\\n");
process.stdin.resume();
`;

/** A child process, its stdout lines, and the text that it wrote to stderr. */
interface Child {
  readonly child: ChildProcessWithoutNullStreams;
  readonly lines: AsyncIterator<string>;
  /** Settles with the exit code and the signal when the child exits and closes its pipes. */
  readonly closed: Promise<Array<unknown>>;
  stderr: string;
  stdinError: string;
}

function startChild(script: string, lock: string, args: ReadonlyArray<string> = []): Child {
  // Bun runs the child, because it loads the TypeScript module without a build step.
  const child = spawn(BUN_RUNTIME, [script, LOCK_MODULE, lock, ...args], { stdio: "pipe" });
  children.push(child);
  const started: Child = {
    child,
    lines: createInterface({ input: child.stdout })[Symbol.asyncIterator](),
    closed: once(child, "close"),
    stderr: "",
    stdinError: "",
  };
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    started.stderr += chunk;
  });
  // A child that exits early closes its stdin, so a later write fails with EPIPE.
  child.stdin.on("error", (cause: NodeJS.ErrnoException) => {
    started.stdinError = cause.code ?? cause.message;
  });
  return started;
}

async function nextLine(started: Child): Promise<string> {
  const line = await started.lines.next();
  return line.done === true ? "closed" : String(line.value);
}

function send(started: ReadonlyArray<Child>, command: string): void {
  for (const one of started) one.child.stdin.write(`${command}\n`);
}

/**
 * Fail when a child printed a line that is not in `allowed`. The message shows
 * the line, the exit code, the signal, and the stderr of each such child. The
 * check stops all children first, so that each child has an exit status.
 */
async function expectLines(
  started: ReadonlyArray<Child>,
  lines: ReadonlyArray<string>,
  allowed: Record<string, true>,
): Promise<void> {
  const strays = lines.flatMap((line, index) => (allowed[line] === true ? [] : [index]));
  if (strays.length === 0) return;
  for (const one of started) one.child.kill();
  const reports = await Promise.all(
    strays.map(async (index) => {
      const one = started[index]!;
      const [code, signal] = await one.closed;
      return [
        `child ${index} printed ${JSON.stringify(lines[index])}`,
        `exit code ${String(code)}, signal ${String(signal)}`,
        ...(one.stdinError === "" ? [] : [`stdin write error ${one.stdinError}`]),
        `stderr:\n${one.stderr === "" ? "(empty)" : one.stderr}`,
      ].join("\n");
    }),
  );
  expect(
    strays.map((index) => lines[index]),
    `\n${reports.join("\n\n")}\n`,
  ).toEqual([]);
}

/** One round: start `count` racers on one lock, release them all, and return their results. */
async function raceOnce(
  lock: string,
  script: string,
  count: number,
  waitMs: number,
): Promise<Array<string>> {
  const racers = Array.from({ length: count }, () => startChild(script, lock, [String(waitMs)]));

  await expectLines(racers, await Promise.all(racers.map(nextLine)), { ready: true });
  send(racers, `go ${Date.now() + START_DELAY_MS}`);
  const results = await Promise.all(racers.map(nextLine));
  send(racers, "release");
  await Promise.all(racers.map((racer) => racer.closed));
  await expectLines(racers, results, { acquired: true, held: true });
  return results;
}

describe("acquireKitLock across processes", () => {
  it(
    "lets exactly one of 8 racing processes take the lock, in each of 5 rounds",
    async () => {
      const base = sandbox();
      const script = join(base, "racer.mjs");
      writeFileSync(script, RACER);
      const lock = join(base, "race-lock.db");

      for (let round = 0; round < 5; round += 1) {
        const results = await raceOnce(lock, script, RACERS, 500);
        expect(results.filter((result) => result === "acquired")).toHaveLength(1);
        expect(results.filter((result) => result === "held")).toHaveLength(RACERS - 1);
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  // With `BEGIN EXCLUSIVE`, each racer holds SHARED while it tries to move up,
  // so all racers could fail at once (self-review round 1 of plan #161).
  it(
    "lets exactly one of 4 racers that start at the same moment take the lock with no wait, in each of 10 rounds",
    async () => {
      const base = sandbox();
      const script = join(base, "racer.mjs");
      writeFileSync(script, RACER);
      const lock = join(base, "zero-wait-lock.db");

      for (let round = 0; round < 10; round += 1) {
        const results = await raceOnce(lock, script, 4, 0);
        expect(results.filter((result) => result === "acquired")).toHaveLength(1);
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "lets a contender take the lock after the holder process gets SIGKILL",
    async () => {
      const base = sandbox();
      const script = join(base, "holder.mjs");
      writeFileSync(script, HOLDER);
      const lock = join(base, "kill-lock.db");
      const holder = startChild(script, lock);

      await expectLines([holder], [await nextLine(holder)], { acquired: true });
      expect(await probe(lock)).toBe("held");

      holder.child.kill("SIGKILL");
      const [, signal] = await holder.closed;
      if (POSIX) expect(signal).toBe("SIGKILL");

      expect(await probe(lock, 5_000)).toBe("acquired");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "keeps the lock across a forced garbage collection in the holder process",
    async () => {
      const base = sandbox();
      const script = join(base, "holder.mjs");
      writeFileSync(script, HOLDER);
      const lock = join(base, "gc-lock.db");
      const holder = startChild(script, lock);

      const lines = [await nextLine(holder), await nextLine(holder)];
      await expectLines([holder], lines.slice(0, 1), { acquired: true });
      await expectLines([holder], lines.slice(1), { collected: true });

      expect(await probe(lock)).toBe("held");
      holder.child.kill();
      await holder.closed;
    },
    SPAWN_TIMEOUT_MS,
  );
});
