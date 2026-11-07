import { BunServices } from "@effect/platform-bun";
import { Effect, Exit } from "effect";
import { Command } from "effect/cli";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
import { parse } from "yaml";

import { ompCommand } from "../../src/commands/omp";
import { acquireKitLock, releaseKitLock } from "../../src/engine-native/kitLock";
import { toggleDeployedOpenAiFast, toggleOpenAiFast } from "../../src/engine-native/ompFastMode";
import { mergeOmpConfig } from "../../src/engine-native/ompYaml";
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

describe("omp --fast under the folder lock", () => {
  it("exits 1 with the held line and leaves config.yml unchanged while a sync holds the omp agent folder", async () => {
    const home = realpathSync.native(mkdtempSync(join(tmpdir(), "omp-fast-lock-")));
    roots.push(home);
    // engineHome reads USERPROFILE on win32, so both keys point at the temp home.
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    for (const key of ["PI_CODING_AGENT_DIR", "OMP_PROFILE", "PI_PROFILE", "PI_CONFIG_DIR"]) {
      vi.stubEnv(key, undefined);
    }
    // A short wait, so that the held lock ends the run quickly.
    vi.stubEnv("DOCKS_KIT_SYNC_LOCK_WAIT_MS", "100");
    const agentDir = join(home, ".omp", "agent");
    mkdirSync(agentDir, { recursive: true });
    const configPath = join(agentDir, "config.yml");
    writeFileSync(configPath, CONFIG);
    const lock = join(agentDir, FOLDER_LOCK);
    const held = await acquireKitLock(lock, { waitMs: 0, privateDirectory: false });
    if (held.kind !== "acquired") throw new Error(`expected a free lock at ${lock}`);

    try {
      const run = await runFast();

      expect(run.exitCode).toBe(1);
      expect(run.output).toContain(
        `another docks-kit sync holds ${lock}; run sync again after it ends`,
      );
      expect(readFileSync(configPath, "utf8")).toBe(CONFIG);
    } finally {
      releaseKitLock(held.lock);
    }
  });
});
