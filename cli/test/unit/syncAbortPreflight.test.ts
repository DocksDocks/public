import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runEngineNative } from "../../src/engine-native";
import { DEPENDENCIES } from "../../src/engine-native/deps";
import { p } from "../../src/engine-native/exec";
import { makePlatform, type EngineServices } from "../../src/engine-native/services";

interface LogRecord {
  readonly level: "change" | "verbose" | "warn" | "err" | "echo";
  readonly message: string;
}

function recordingServices(records: Array<LogRecord>): EngineServices {
  return {
    logger: {
      change: (message) => void records.push({ level: "change", message }),
      progress: () => {},
      clearProgress: () => {},
      verbose: (message) => void records.push({ level: "verbose", message }),
      warn: (message) => void records.push({ level: "warn", message }),
      err: (message) => void records.push({ level: "err", message }),
      echo: (message) => void records.push({ level: "echo", message }),
      acquireTerminal: () => ({
        update: () => {},
        withExclusive: async (action) => await action(),
        release: () => {},
      }),
    },
    deps: {
      spec: (id) => DEPENDENCIES[id],
      probe: (id) => ({ state: "present", path: `/stub-bin/${id}` }),
      version: async () => "",
      versionReading: async () => ({ kind: "version", value: "" }),
      path: async (id) => `/stub-bin/${id}`,
      warnMissing: () => {},
    },
    platform: makePlatform("linux"),
  };
}

describe("sync abort preflight", () => {
  it("stops every pipeline before it starts when Claude settings are not valid JSON", async () => {
    const home = mkdtempSync(join(tmpdir(), "sync-abort-preflight-"));
    const keys = [
      "HOME",
      "USERPROFILE",
      "AGENTS_DIR",
      "DOCKS_KIT_INTERACTIVE",
      "DOCKS_KIT_SYNC_CONCURRENCY",
    ] as const;
    const previous = keys.map((key) => [key, process.env[key]] as const);
    try {
      for (const key of keys) delete process.env[key];
      process.env["HOME"] = home;
      process.env["USERPROFILE"] = home;
      process.env["DOCKS_KIT_INTERACTIVE"] = "0";
      mkdirSync(join(home, ".claude"));
      writeFileSync(join(home, ".claude", "settings.json"), "not-json");

      const records: Array<LogRecord> = [];
      const exitCode = await runEngineNative(
        ["sync", "claude", "codex", "agents", "omp", "--dry-run"],
        recordingServices(records),
      );

      expect(exitCode).toBe(1);
      const settingsPath = p(home, ".claude", "settings.json");
      expect(records).toEqual([
        {
          level: "err",
          message: `Aborting sync: ${settingsPath} is not valid JSON. Fix it manually or delete it to reinstall.`,
        },
      ]);
      expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toBe("not-json");
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(home, { recursive: true, force: true });
    }
  });
});
