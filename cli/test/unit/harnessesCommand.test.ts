import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { stripVTControlCharacters } from "node:util";
import { BunServices } from "@effect/platform-bun";
import { type Cause, Effect, Exit, Option, Queue, Terminal } from "effect";
import { Command } from "effect/unstable/cli";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { harnessesCommand } from "../../src/commands/harnesses";
import {
  HARNESSES,
  readHarnessSelection,
  writeHarnessSelection,
  type Harness,
} from "../../src/engine-native/harnesses";
import { kitDbFile } from "../../src/engine-native/kitDb";
import { runPublicCli } from "../lib/goldenExecution";
import { cleanupTemporaryDirs, makeStubDir, temporaryDir } from "../lib/goldenResources";
import { SPAWN_TIMEOUT_MS } from "../lib/spawnTimeout";

afterAll(cleanupTemporaryDirs);

describe("harnesses command", () => {
  it(
    "reports the legacy default without creating selection state",
    () => {
      const run = runPublicCli(["harnesses"], "home-fresh", makeStubDir());

      expect(run.exitCode).toBe(0);
      expect(run.stderr).toBe("");
      expect(run.stdout).toBe(
        "Harness selection: claude, codex, agents (no selection is stored yet; the legacy default applies)\n",
      );
      expect(existsSync(kitDbFile(run.home))).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reports an omp-only stored selection exactly",
    () => {
      const home = temporaryDir("harnesses-command-home-");
      writeHarnessSelection(home, ["omp"]);

      const run = runPublicCli(["harnesses"], "home-fresh", makeStubDir(), { reuseHome: home });

      expect(run.exitCode).toBe(0);
      expect(run.stderr).toBe("");
      expect(run.stdout).toBe("Harness selection: omp\n");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "fails with the upgrade hint when the store has a newer schema",
    () => {
      const home = temporaryDir("harnesses-command-home-");
      writeHarnessSelection(home, ["omp"]);
      const db = new DatabaseSync(kitDbFile(home));
      db.exec("PRAGMA user_version = 99");
      db.close();

      const run = runPublicCli(["harnesses"], "home-fresh", makeStubDir(), { reuseHome: home });

      expect(run.exitCode).not.toBe(0);
      expect(run.stderr).toMatch(/Cannot read .*schema 99.*Upgrade docks-kit/s);
      expect(run.stdout).not.toContain("no selection is stored yet");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "fails with the store path when kit.db is corrupt",
    () => {
      const home = temporaryDir("harnesses-command-home-");
      mkdirSync(join(home, ".docks-kit"));
      writeFileSync(kitDbFile(home), "not a SQLite database");

      const run = runPublicCli(["harnesses"], "home-fresh", makeStubDir(), { reuseHome: home });

      expect(run.exitCode).not.toBe(0);
      expect(run.stderr).toContain("Cannot read");
      expect(run.stdout).not.toContain("no selection is stored yet");
    },
    SPAWN_TIMEOUT_MS,
  );
});

const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

function restore(stream: NodeJS.ReadStream | NodeJS.WriteStream, saved?: PropertyDescriptor) {
  if (saved === undefined) {
    Reflect.deleteProperty(stream, "isTTY");
  } else {
    Object.defineProperty(stream, "isTTY", saved);
  }
}

describe("harnesses command picker gate", () => {
  let home: string | undefined;

  afterEach(() => {
    restore(process.stdin, stdinTty);
    restore(process.stdout, stdoutTty);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
    home = undefined;
  });

  it("does not open the picker when stdin is not a terminal", async () => {
    home = mkdtempSync(join(tmpdir(), "docks-harnesses-tty-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const exit = await Effect.runPromiseExit(
      Command.runWith(harnessesCommand, { version: "x" })([]).pipe(
        Effect.provide(BunServices.layer),
      ),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(log.mock.calls).toEqual([
      [
        "Harness selection: claude, codex, agents (no selection is stored yet; the legacy default applies)",
      ],
    ]);
    expect(existsSync(kitDbFile(home))).toBe(false);
  });
});

interface KeyPress {
  readonly name: string;
  readonly sequence?: string;
}

const DOWN: KeyPress = { name: "down", sequence: "\x1b[B" };
const END: KeyPress = { name: "end", sequence: "\x1b[F" };
const ENTER: KeyPress = { name: "return", sequence: "\r" };
const ESCAPE: KeyPress = { name: "escape", sequence: "\x1b" };

const LEGACY_FIRST_LINE =
  "Harness selection: claude, codex, agents (no selection is stored yet; the legacy default applies)";
const NOTE = "Every harness starts ticked. Nothing is stored until you save.";

/** A terminal that feeds `keys` in order, then ends its input, and records every displayed frame. */
function fakeTerminal(keys: ReadonlyArray<KeyPress>, frames: Array<string>): Terminal.Terminal {
  return Terminal.make({
    columns: Effect.succeed(80),
    rows: Effect.succeed(24),
    readInput: Effect.gen(function* () {
      const queue = yield* Queue.unbounded<Terminal.UserInput, Cause.Done>();
      yield* Queue.offerAll(
        queue,
        keys.map((key) => ({
          input: Option.fromUndefinedOr(key.sequence),
          key: { name: key.name, ctrl: false, meta: false, shift: false },
        })),
      );
      yield* Queue.end(queue);
      return queue;
    }),
    readLine: Effect.die("the harness picker does not read lines"),
    display: (text) =>
      Effect.sync(() => {
        frames.push(stripVTControlCharacters(text));
      }),
  });
}

/** The tick marker on the row of `harness` in a frame, or undefined when the row is absent. */
function marker(frame: string, harness: string): string | undefined {
  const row = frame.split(/\r?\n/).find((line) => new RegExp(`[●○]\\s+${harness}\\s`).test(line));
  return row?.match(/[●○]/)?.[0];
}

describe("harnesses command picker", () => {
  let home = "";

  afterEach(() => {
    restore(process.stdin, stdinTty);
    restore(process.stdout, stdoutTty);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (home !== "") rmSync(home, { recursive: true, force: true });
    home = "";
  });

  /** Runs the command on a fake terminal in a new HOME that holds `stored` when it is given. */
  async function runPicker(keys: ReadonlyArray<KeyPress>, stored?: ReadonlyArray<Harness>) {
    home = mkdtempSync(join(tmpdir(), "docks-harnesses-picker-"));
    if (stored !== undefined) writeHarnessSelection(home, stored);
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    // Windows Terminal selects the Unicode symbol set on every platform.
    vi.stubEnv("WT_SESSION", "1");
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const frames: Array<string> = [];

    const exit = await Effect.runPromiseExit(
      Command.runWith(harnessesCommand, { version: "x" })([]).pipe(
        Effect.provideService(Terminal.Terminal, fakeTerminal(keys, frames)),
        Effect.provide(BunServices.layer),
      ),
    );
    return { exit, frames, logs: log.mock.calls };
  }

  it("saves claude, agents, omp after codex is unticked on a fresh machine", async () => {
    const { exit, logs } = await runPicker([DOWN, ENTER, END, ENTER]);

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(readHarnessSelection(home)).toEqual(["claude", "agents", "omp"]);
    expect(logs).toEqual([
      [LEGACY_FIRST_LINE],
      [`Saved harness selection: claude, agents, omp (${kitDbFile(home)})`],
    ]);
  });

  it("keeps kit.db absent and reports no change when the picker is cancelled", async () => {
    const { exit, logs } = await runPicker([DOWN, ENTER, ESCAPE]);

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(logs).toEqual([[LEGACY_FIRST_LINE], ["Harness selection unchanged."]]);
    expect(existsSync(kitDbFile(home))).toBe(false);
  });

  it("starts from a stored omp-only selection without the note and saves it unchanged", async () => {
    const { exit, frames, logs } = await runPicker([END, ENTER], ["omp"]);

    expect(Exit.isSuccess(exit)).toBe(true);
    const first = frames[0] ?? "";
    expect(HARNESSES.map((harness) => marker(first, harness))).toEqual(["○", "○", "○", "●"]);
    expect(first).not.toContain(NOTE);
    expect(readHarnessSelection(home)).toEqual(["omp"]);
    expect(logs).toEqual([
      ["Harness selection: omp"],
      [`Saved harness selection: omp (${kitDbFile(home)})`],
    ]);
  });

  it("shows the note and ticks all four harnesses when no selection is stored", async () => {
    const { exit, frames } = await runPicker([ESCAPE]);

    expect(Exit.isSuccess(exit)).toBe(true);
    const first = frames[0] ?? "";
    expect(first).toContain(NOTE);
    expect(HARNESSES.map((harness) => marker(first, harness))).toEqual(["●", "●", "●", "●"]);
  });

  it("refuses to save an empty selection and stores nothing after a cancel", async () => {
    const { exit, frames, logs } = await runPicker([
      ENTER,
      DOWN,
      ENTER,
      DOWN,
      ENTER,
      DOWN,
      ENTER,
      END,
      ENTER,
      ESCAPE,
    ]);

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(frames.some((frame) => frame.includes("Tick at least one harness."))).toBe(true);
    expect(logs).toEqual([[LEGACY_FIRST_LINE], ["Harness selection unchanged."]]);
    expect(readHarnessSelection(home)).toBeUndefined();
    expect(existsSync(kitDbFile(home))).toBe(false);
  });
});
