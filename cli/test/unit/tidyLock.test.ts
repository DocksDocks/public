import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { acquireTidyLock, releaseTidyLock } from "../../src/engine-native/tidyLock";
import { BUN_RUNTIME } from "../lib/cliEntry";
import { SPAWN_TIMEOUT_MS } from "../lib/spawnTimeout";

const LOCK_MODULE = resolve(import.meta.dirname, "../../src/engine-native/tidyLock.ts");
const RACERS = 8;

const sandboxes: Array<string> = [];
const children: Array<ChildProcess> = [];

function sandbox(): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "tidy-lock-")));
  sandboxes.push(base);
  return base;
}

/** A PID that no process uses now: the PID of a child that already exited. */
function deadPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}

function setAge(path: string, ageMs: number): void {
  const time = new Date(Date.now() - ageMs);
  utimesSync(path, time, time);
}

/** A lock of a dead run, 2 h old. */
function writeStaleLock(lock: string): void {
  writeFileSync(lock, `${deadPid()} 2020-01-01T00:00:00.000Z deadbeef\n`);
  setAge(lock, 2 * 3_600_000);
}

afterEach(() => {
  for (const base of sandboxes.splice(0)) rmSync(base, { recursive: true, force: true });
});

afterAll(() => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
});

describe("acquireTidyLock", () => {
  it("takes a free lock and writes the PID, the time, and a token", () => {
    const lock = join(sandbox(), "tidy.lock");
    const held = acquireTidyLock(lock, Date.now());

    expect(held).toBeDefined();
    const [pid, time, token] = readFileSync(lock, "utf8").trim().split(" ");
    expect(pid).toBe(String(process.pid));
    expect(Number.isNaN(Date.parse(time ?? ""))).toBe(false);
    expect(token).toBe(held?.token);
  });

  it("refuses a fresh lock of a live process", () => {
    const lock = join(sandbox(), "tidy.lock");
    writeFileSync(lock, `${process.pid} ${new Date().toISOString()} other\n`);

    expect(acquireTidyLock(lock, Date.now())).toBeUndefined();
    expect(readFileSync(lock, "utf8")).toContain(" other");
  });

  it("takes over a stale lock and leaves no takeover mutex", () => {
    const lock = join(sandbox(), "tidy.lock");
    writeStaleLock(lock);

    const held = acquireTidyLock(lock, Date.now());

    expect(held).toBeDefined();
    expect(readFileSync(lock, "utf8")).toContain(held!.token);
    expect(existsSync(`${lock}.takeover`)).toBe(false);
  });

  it("refuses a stale lock while another run holds a fresh takeover mutex", () => {
    const lock = join(sandbox(), "tidy.lock");
    writeStaleLock(lock);
    writeFileSync(`${lock}.takeover`, `${process.pid} ${new Date().toISOString()} other\n`);

    expect(acquireTidyLock(lock, Date.now())).toBeUndefined();
    expect(readFileSync(lock, "utf8")).toContain("deadbeef");
    expect(readFileSync(`${lock}.takeover`, "utf8")).toContain(" other");
  });

  it("removes a takeover mutex older than 60 s once, then takes the stale lock", () => {
    const lock = join(sandbox(), "tidy.lock");
    writeStaleLock(lock);
    writeFileSync(`${lock}.takeover`, `${deadPid()} 2020-01-01T00:00:00.000Z gone\n`);
    setAge(`${lock}.takeover`, 120_000);

    const held = acquireTidyLock(lock, Date.now());

    expect(held).toBeDefined();
    expect(existsSync(`${lock}.takeover`)).toBe(false);
  });
});

describe("releaseTidyLock", () => {
  it("removes the lock only while it still carries the token", () => {
    const lock = join(sandbox(), "tidy.lock");
    const held = acquireTidyLock(lock, Date.now())!;
    writeFileSync(lock, `${process.pid} ${new Date().toISOString()} other\n`);

    releaseTidyLock(held);
    expect(readFileSync(lock, "utf8")).toContain(" other");

    writeFileSync(lock, `${process.pid} ${new Date().toISOString()} ${held.token}\n`);
    releaseTidyLock(held);
    expect(existsSync(lock)).toBe(false);
  });
});

/**
 * Each racer loads the lock module, prints `ready`, and waits for `go` on
 * stdin. It then tries the lock, prints the result, and holds a lock that it
 * took until `release`, so that no late racer can find the lock free.
 */
const RACER = `
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
const [modulePath, lockPath] = process.argv.slice(2);
const { acquireTidyLock, releaseTidyLock } = await import(pathToFileURL(modulePath).href);
const commands = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
process.stdout.write("ready\\n");
await commands.next();
const lock = acquireTidyLock(lockPath, Date.now());
process.stdout.write(lock === undefined ? "locked\\n" : "acquired\\n");
await commands.next();
if (lock !== undefined) releaseTidyLock(lock);
process.exit(0);
`;

/** One round: start 8 racers on a stale lock, release them all, and return their results. */
async function raceOnce(base: string, script: string): Promise<Array<string>> {
  const lock = join(base, "tidy.lock");
  writeStaleLock(lock);
  // Bun runs the child, because it loads the TypeScript module without a build step.
  const racers = Array.from({ length: RACERS }, () => {
    const child = spawn(BUN_RUNTIME, [script, LOCK_MODULE, lock], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    children.push(child);
    return {
      child,
      exit: once(child, "exit"),
      lines: createInterface({ input: child.stdout! })[Symbol.asyncIterator](),
    };
  });
  const nextLine = async (racer: (typeof racers)[number]): Promise<string> => {
    const line = await racer.lines.next();
    return line.done === true ? "closed" : String(line.value);
  };

  expect(await Promise.all(racers.map(nextLine))).toEqual(Array(RACERS).fill("ready"));
  for (const racer of racers) racer.child.stdin!.write("go\n");
  const results = await Promise.all(racers.map(nextLine));
  for (const racer of racers) racer.child.stdin!.write("release\n");
  await Promise.all(racers.map((racer) => racer.exit));
  expect(existsSync(lock)).toBe(false);
  expect(existsSync(`${lock}.takeover`)).toBe(false);
  return results;
}

describe("acquireTidyLock across processes", () => {
  // The pre-fix takeover (unlink, then `wx`) let two racers succeed in about 40% of
  // the rounds on a developer machine, so five rounds expose it almost every run.
  it(
    "lets exactly one of 8 racing processes take over a stale lock, in each of 5 rounds",
    async () => {
      const base = sandbox();
      const script = join(base, "racer.mjs");
      writeFileSync(script, RACER);

      for (let round = 0; round < 5; round += 1) {
        const results = await raceOnce(base, script);
        expect(results.filter((result) => result === "acquired")).toHaveLength(1);
        expect(results.filter((result) => result === "locked")).toHaveLength(RACERS - 1);
      }
    },
    SPAWN_TIMEOUT_MS,
  );
});
