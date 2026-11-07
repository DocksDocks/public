import { BunServices } from "@effect/platform-bun";
import { Effect, Exit } from "effect";
import { Command } from "effect/cli";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleepMs } from "node:timers/promises";
import { parse } from "yaml";

import { ompCommand } from "../../src/commands/omp";
import { acquireKitLock, releaseKitLock, type KitLock } from "../../src/engine-native/kitLock";
import { toggleDeployedOpenAiFast, toggleOpenAiFast } from "../../src/engine-native/ompFastMode";
import { mergeOmpConfig } from "../../src/engine-native/ompYaml";
import { syncLockPath } from "../../src/engine-native/scratch";
import { payloadText } from "../../src/payload";

const roots: Array<string> = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const CONFIG = `# user note
tier:
  openai: none
  anthropic: none

advisor:
  enabled: true
`;

describe("toggleOpenAiFast", () => {
  it("turns fast on and changes only tier.openai", () => {
    const toggle = toggleOpenAiFast(CONFIG);
    expect(toggle).toMatchObject({ previous: "none", next: "priority" });
    expect(toggle.text).toBe(CONFIG.replace("openai: none", "openai: priority"));
  });

  it("turns fast off when tier.openai is priority", () => {
    const toggle = toggleOpenAiFast(toggleOpenAiFast(CONFIG).text);
    expect(toggle).toMatchObject({ previous: "priority", next: "none" });
    expect(toggle.text).toBe(CONFIG);
  });

  it("replaces ultrafast with plain fast instead of turning off", () => {
    const toggle = toggleOpenAiFast(CONFIG.replace("openai: none", "openai: ultrafast"));
    expect(toggle).toMatchObject({ previous: "ultrafast", next: "priority" });
  });

  it("treats a missing tier block as off and creates it", () => {
    const toggle = toggleOpenAiFast("advisor:\n  enabled: true\n");
    expect(toggle).toMatchObject({ previous: "none", next: "priority" });
    expect(parse(toggle.text)).toEqual({
      advisor: { enabled: true },
      tier: { openai: "priority" },
    });
  });

  it("rejects a tier key that is not a mapping", () => {
    expect(() => toggleOpenAiFast("tier: fast\n")).toThrow(
      "omp config.yml key 'tier' must be a mapping",
    );
  });

  it("survives a sync merge with the shipped SoT config", () => {
    const deployed = toggleOpenAiFast(CONFIG).text;
    const merged = parse(mergeOmpConfig(payloadText("SoT/.omp/config.yml"), deployed));
    expect(merged.tier.openai).toBe("priority");
  });
});

describe("toggleDeployedOpenAiFast", () => {
  it("keeps a symlinked config.yml a link", () => {
    const root = mkdtempSync(join(tmpdir(), "omp-fast-link-"));
    roots.push(root);
    const dotfiles = join(root, "dotfiles");
    mkdirSync(dotfiles);
    const linkTarget = join(dotfiles, "config.yml");
    writeFileSync(linkTarget, CONFIG);
    const configPath = join(root, "config.yml");
    symlinkSync(linkTarget, configPath);

    const toggle = toggleDeployedOpenAiFast(configPath);

    expect(toggle).toMatchObject({ previous: "none", next: "priority" });
    expect(lstatSync(configPath).isSymbolicLink()).toBe(true);
    expect(parse(readFileSync(linkTarget, "utf8")).tier.openai).toBe("priority");
  });
});

/** The lock file that a writing sync takes inside the omp agent folder. */
const FOLDER_LOCK = ".docks-kit-sync-lock.db";

/**
 * Run `docks-kit omp --fast` in this process. Record what it prints and its
 * exit code: the code of a `process.exit` call, else 1 for a failure and 0
 * for a success, as `BunRuntime.runMain` does.
 */
async function runFast(): Promise<{ readonly exitCode: number; readonly output: string }> {
  const lines: Array<string> = [];
  const record = (...values: Array<unknown>) => void lines.push(values.map(String).join(" "));
  vi.spyOn(console, "log").mockImplementation(record);
  vi.spyOn(console, "error").mockImplementation(record);
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => record(chunk) ?? true);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => record(chunk) ?? true);
  const exitCodes: Array<number> = [];
  vi.spyOn(process, "exit").mockImplementation((code) => {
    exitCodes.push(Number(code ?? 0));
    throw new Error(`exit ${String(code)}`);
  });

  const exit = await Effect.runPromiseExit(
    Command.runWith(ompCommand, { version: "x" })(["--fast"]).pipe(
      Effect.provide(BunServices.layer),
    ),
  );
  vi.restoreAllMocks();

  const exitCode = exitCodes[0] ?? (Exit.isSuccess(exit) ? 0 : 1);
  return { exitCode, output: lines.join("\n") };
}

/** A temporary HOME for `omp --fast`, set in-process, with the lock wait bound `waitMs`. */
function fastHome(waitMs: string): { readonly home: string; readonly agentDir: string } {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "omp-fast-lock-")));
  roots.push(home);
  // engineHome reads USERPROFILE on win32, so both keys point at the temp home.
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  for (const key of ["PI_CODING_AGENT_DIR", "OMP_PROFILE", "PI_PROFILE", "PI_CONFIG_DIR"]) {
    vi.stubEnv(key, undefined);
  }
  vi.stubEnv("DOCKS_KIT_SYNC_LOCK_WAIT_MS", waitMs);
  return { home, agentDir: join(home, ".omp", "agent") };
}

/** Take the lock at `path` as another run does, or throw when it is held. */
async function takeLock(path: string, privateDirectory: boolean): Promise<KitLock> {
  const held = await acquireKitLock(path, { waitMs: 0, privateDirectory });
  if (held.kind !== "acquired") throw new Error(`expected a free lock at ${path}`);
  return held.lock;
}

function heldLine(lock: string): string {
  return `another docks-kit sync holds ${lock}; run sync again after it ends`;
}

describe("omp --fast under the folder lock", () => {
  it("exits 1 with the held line and leaves config.yml unchanged while a sync holds the omp agent folder", async () => {
    // A short wait, so that the held lock ends the run quickly.
    const { agentDir } = fastHome("100");
    mkdirSync(agentDir, { recursive: true });
    const configPath = join(agentDir, "config.yml");
    writeFileSync(configPath, CONFIG);
    const lock = join(agentDir, FOLDER_LOCK);
    const held = await takeLock(lock, false);

    try {
      const run = await runFast();

      expect(run.exitCode).toBe(1);
      expect(run.output).toContain(heldLine(lock));
      expect(readFileSync(configPath, "utf8")).toBe(CONFIG);
    } finally {
      releaseKitLock(held);
    }
  });

  it("exits 1 with the held line and leaves config.yml unchanged while a sync holds the home sync lock", async () => {
    const { home, agentDir } = fastHome("100");
    mkdirSync(agentDir, { recursive: true });
    const configPath = join(agentDir, "config.yml");
    writeFileSync(configPath, CONFIG);
    const lock = syncLockPath(home);
    const held = await takeLock(lock, true);

    try {
      const run = await runFast();

      expect(run.exitCode).toBe(1);
      expect(run.output).toContain(heldLine(lock));
      expect(readFileSync(configPath, "utf8")).toBe(CONFIG);
    } finally {
      releaseKitLock(held);
    }
  });

  it("exits 2 before any lock when config.yml is missing, so a folder that appears during the home lock wait is not toggled", async () => {
    // A long wait: a run that waits for the home lock is still waiting when the folder appears.
    const { home, agentDir } = fastHome("10000");
    const configPath = join(agentDir, "config.yml");
    const homeLock = await takeLock(syncLockPath(home), true);
    let folderLock: KitLock | undefined;

    try {
      const pending = runFast();
      // The check before the locks ends the run at once; a run that waits is still pending.
      await Promise.race([pending, sleepMs(3000)]);
      expect(existsSync(join(home, ".omp"))).toBe(false);

      // A sync of another home that shares the folder creates it and holds its lock.
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(configPath, CONFIG);
      folderLock = await takeLock(join(agentDir, FOLDER_LOCK), false);
      releaseKitLock(homeLock);
      const run = await pending;

      expect(run.exitCode).toBe(2);
      // The kit joins its paths with "/", so compare the path without its separator style.
      expect(run.output.replaceAll("\\", "/")).toContain(
        `${configPath.replaceAll("\\", "/")} does not exist; run 'docks-kit sync omp' first`,
      );
      expect(readFileSync(configPath, "utf8")).toBe(CONFIG);
    } finally {
      if (folderLock !== undefined) releaseKitLock(folderLock);
      else releaseKitLock(homeLock);
    }
  });

  it("exits 1 with the held line when another home takes the omp agent folder lock while --fast waits for the home lock", async () => {
    // The home lock goes before this wait ends; the folder lock stays past it.
    const { home, agentDir } = fastHome("1000");
    mkdirSync(agentDir, { recursive: true });
    const configPath = join(agentDir, "config.yml");
    writeFileSync(configPath, CONFIG);
    const homeLock = await takeLock(syncLockPath(home), true);
    const lock = join(agentDir, FOLDER_LOCK);
    let folderLock: KitLock | undefined;

    try {
      const pending = runFast();
      await sleepMs(200);
      folderLock = await takeLock(lock, false);
      releaseKitLock(homeLock);
      const run = await pending;

      expect(run.exitCode).toBe(1);
      expect(run.output).toContain(heldLine(lock));
      expect(readFileSync(configPath, "utf8")).toBe(CONFIG);
    } finally {
      if (folderLock !== undefined) releaseKitLock(folderLock);
      else releaseKitLock(homeLock);
    }
  });
});
