import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BunServices } from "@effect/platform-bun";
import { Effect, Exit } from "effect";
import { Command } from "effect/unstable/cli";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { harnessesCommand } from "../../src/commands/harnesses";
import { writeHarnessSelection } from "../../src/engine-native/harnesses";
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

describe("harnesses command picker gate", () => {
  const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  let home: string | undefined;

  function restore(stream: NodeJS.ReadStream | NodeJS.WriteStream, saved?: PropertyDescriptor) {
    if (saved === undefined) {
      Reflect.deleteProperty(stream, "isTTY");
    } else {
      Object.defineProperty(stream, "isTTY", saved);
    }
  }

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
