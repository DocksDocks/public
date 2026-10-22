import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
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
import type * as FsModule from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const faults = vi.hoisted(() => ({
  /** Errors to throw once: the next `call` of `node:fs` on `path` throws `code`. */
  pending: [] as Array<{ call: string; path: string; code: string }>,
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof FsModule>("node:fs");
  /** Wrap `real` so that a pending fault for `call` on the path throws once. */
  function faulty<Real extends (path: FsModule.PathLike, ...rest: Array<never>) => unknown>(
    call: string,
    real: Real,
  ): Real {
    return ((path: FsModule.PathLike, ...rest: Array<never>) => {
      const index = faults.pending.findIndex(
        (fault) => fault.call === call && fault.path === String(path),
      );
      if (index !== -1) {
        const { code } = faults.pending.splice(index, 1)[0]!;
        throw Object.assign(new Error(`${code}: injected fault, ${call} '${String(path)}'`), {
          code,
        });
      }
      return real(path, ...rest);
    }) as Real;
  }
  return {
    ...actual,
    lstatSync: faulty("lstatSync", actual.lstatSync),
    openSync: faulty("openSync", actual.openSync),
    unlinkSync: faulty("unlinkSync", actual.unlinkSync),
  };
});

import { acquireTidyLock, releaseTidyLock } from "../../src/engine-native/tidyLock";
import { BUN_RUNTIME } from "../lib/cliEntry";
import { SPAWN_TIMEOUT_MS } from "../lib/spawnTimeout";

const LOCK_MODULE = resolve(import.meta.dirname, "../../src/engine-native/tidyLock.ts");
const RACERS = 8;

const sandboxes: Array<string> = [];
const children: Array<ChildProcessWithoutNullStreams> = [];

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

/** Make the next `call` of `node:fs` on `path` throw an error with `code`, once. */
function inject(call: "lstatSync" | "openSync" | "unlinkSync", path: string, code: string): void {
  faults.pending.push({ call, path, code });
}

/** Try the lock once: `acquired`, `locked`, or `threw <code>` for an error that escapes. */
function attempt(lock: string): string {
  try {
    return acquireTidyLock(lock, Date.now()) === undefined ? "locked" : "acquired";
  } catch (cause) {
    return `threw ${String((cause as NodeJS.ErrnoException).code)}`;
  }
}

afterEach(() => {
  faults.pending.length = 0;
  vi.restoreAllMocks();
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
 * On Windows, a file that one run deletes stays "delete pending" while a handle
 * to it is open. libuv then reports EPERM when a run opens or deletes that name,
 * and EBUSY when an open handle does not share delete access. Each test injects
 * one such error where a racer can meet it.
 */
describe("acquireTidyLock on Windows while another run deletes a lock file", () => {
  function onWindows(): void {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  }

  /** A stale lock that another run takes over now: it holds a fresh takeover mutex. */
  function staleLockInTakeover(): string {
    const lock = join(sandbox(), "tidy.lock");
    writeStaleLock(lock);
    writeFileSync(`${lock}.takeover`, `${process.pid} ${new Date().toISOString()} other\n`);
    return lock;
  }

  it("reports the lock as held when the exclusive create of the lock fails with EPERM", () => {
    const lock = staleLockInTakeover();
    onWindows();
    inject("openSync", lock, "EPERM");

    expect(attempt(lock)).toBe("locked");
    expect(faults.pending).toEqual([]);
    expect(readFileSync(lock, "utf8")).toContain("deadbeef");
    expect(readFileSync(`${lock}.takeover`, "utf8")).toContain(" other");
  });

  it("reports the lock as held when lstat of the lock fails with EPERM", () => {
    const lock = staleLockInTakeover();
    onWindows();
    inject("lstatSync", lock, "EPERM");

    expect(attempt(lock)).toBe("locked");
    expect(faults.pending).toEqual([]);
    expect(readFileSync(lock, "utf8")).toContain("deadbeef");
    expect(readFileSync(`${lock}.takeover`, "utf8")).toContain(" other");
  });

  it("reports the lock as held and keeps the stale lock when its removal fails with EBUSY", () => {
    const lock = join(sandbox(), "tidy.lock");
    writeStaleLock(lock);
    onWindows();
    inject("unlinkSync", lock, "EBUSY");

    expect(attempt(lock)).toBe("locked");
    expect(faults.pending).toEqual([]);
    expect(readFileSync(lock, "utf8")).toContain("deadbeef");
    expect(existsSync(`${lock}.takeover`)).toBe(false);
    // The next run takes the stale lock over.
    expect(attempt(lock)).toBe("acquired");
  });

  it.each([
    { platform: "win32", code: "EACCES" },
    { platform: "win32", code: "EIO" },
    { platform: "linux", code: "EPERM" },
  ] as const)("throws $code from the exclusive create on $platform", ({ platform, code }) => {
    const lock = join(sandbox(), "tidy.lock");
    vi.spyOn(process, "platform", "get").mockReturnValue(platform);
    inject("openSync", lock, code);

    expect(attempt(lock)).toBe(`threw ${code}`);
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

/** A racer process, its stdout lines, and the text that it wrote to stderr. */
interface Racer {
  readonly child: ChildProcessWithoutNullStreams;
  readonly lines: AsyncIterator<string>;
  /** Settles with the exit code and the signal when the racer exits and closes its pipes. */
  readonly closed: Promise<Array<unknown>>;
  stderr: string;
  stdinError: string;
}

function startRacer(script: string, lock: string): Racer {
  // Bun runs the child, because it loads the TypeScript module without a build step.
  const child = spawn(BUN_RUNTIME, [script, LOCK_MODULE, lock], { stdio: "pipe" });
  children.push(child);
  const racer: Racer = {
    child,
    lines: createInterface({ input: child.stdout })[Symbol.asyncIterator](),
    closed: once(child, "close"),
    stderr: "",
    stdinError: "",
  };
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    racer.stderr += chunk;
  });
  // A racer that exits early closes its stdin, so a later write fails with EPIPE.
  // The report of that racer shows the error.
  child.stdin.on("error", (cause: NodeJS.ErrnoException) => {
    racer.stdinError = cause.code ?? cause.message;
  });
  return racer;
}

async function nextLine(racer: Racer): Promise<string> {
  const line = await racer.lines.next();
  return line.done === true ? "closed" : String(line.value);
}

function send(racers: ReadonlyArray<Racer>, command: string): void {
  for (const racer of racers) racer.child.stdin.write(`${command}\n`);
}

/**
 * Fail when a racer printed a line that is not in `allowed`. The message shows
 * the line, the exit code, the signal, and the stderr of each such racer. The
 * check stops all racers first, so that each racer has an exit status.
 */
async function expectLines(
  racers: ReadonlyArray<Racer>,
  lines: ReadonlyArray<string>,
  allowed: Record<string, true>,
): Promise<void> {
  const strays = lines.flatMap((line, index) => (allowed[line] === true ? [] : [index]));
  if (strays.length === 0) return;
  for (const racer of racers) racer.child.kill();
  const reports = await Promise.all(
    strays.map(async (index) => {
      const racer = racers[index]!;
      const [code, signal] = await racer.closed;
      return [
        `racer ${index} printed ${JSON.stringify(lines[index])}`,
        `exit code ${String(code)}, signal ${String(signal)}`,
        ...(racer.stdinError === "" ? [] : [`stdin write error ${racer.stdinError}`]),
        `stderr:\n${racer.stderr === "" ? "(empty)" : racer.stderr}`,
      ].join("\n");
    }),
  );
  expect(
    strays.map((index) => lines[index]),
    `\n${reports.join("\n\n")}\n`,
  ).toEqual([]);
}

/** One round: start 8 racers on a stale lock, release them all, and return their results. */
async function raceOnce(base: string, script: string): Promise<Array<string>> {
  const lock = join(base, "tidy.lock");
  writeStaleLock(lock);
  const racers = Array.from({ length: RACERS }, () => startRacer(script, lock));

  await expectLines(racers, await Promise.all(racers.map(nextLine)), { ready: true });
  send(racers, "go");
  const results = await Promise.all(racers.map(nextLine));
  send(racers, "release");
  await Promise.all(racers.map((racer) => racer.closed));
  await expectLines(racers, results, { acquired: true, locked: true });
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
