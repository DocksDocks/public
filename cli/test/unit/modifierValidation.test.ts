import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runEngineNative } from "../../src/engine-native";
import { DEPENDENCIES } from "../../src/engine-native/deps";
import {
  makePlatform,
  type DependencyManager,
  type EngineServices,
  type Logger,
} from "../../src/engine-native/services";

interface LogRecord {
  readonly level: "change" | "verbose" | "warn" | "err" | "echo";
  readonly message: string;
}

function stubServices(records: Array<LogRecord>): EngineServices {
  const logger: Logger = {
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
  };
  const platform = makePlatform("linux");
  const deps: DependencyManager = {
    spec: (id) => {
      const specification = DEPENDENCIES[id];
      return {
        ...specification,
        installHint: (value = platform.raw()) => specification.installHint(value),
      };
    },
    probe: (id) => ({ state: "present", path: `/stub-bin/${id}` }),
    version: async (id) => (id === "bun" ? "1.4.0" : "0.5.3"),
    path: async (id) => `/stub-bin/${id}`,
    warnMissing: () => {},
  };
  return { logger, deps, platform };
}

const ENV_KEYS = [
  "HOME",
  "AGENTS_DIR",
  "DRY_RUN",
  "DOCKS_KIT_VERBOSE",
  "DOCKS_KIT_INTERACTIVE",
  "SKIP_BUBBLEWRAP",
  "RECONCILE",
  "PRUNE",
  "CLAUDE_COMPACT_WINDOW",
  "CLAUDE_PERMISSIVE",
  "CLAUDE_PLUGINS",
  "CLAUDE_MODEL",
  "CODEX_MODEL",
  "DOCKS_KIT_SYNC_CONCURRENCY",
] as const;

describe("modifier field validation", () => {
  let root = "";
  let previous = new Map<string, string | undefined>();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "modifier-validation-"));
    previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    process.env["HOME"] = root;
    process.env["AGENTS_DIR"] = join(root, ".agents");
  });

  afterEach(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("normalizes CLAUDE_COMPACT_WINDOW through the flag parser and rejects junk", async () => {
    process.env["CLAUDE_COMPACT_WINDOW"] = "680k";
    const environmentRecords: Array<LogRecord> = [];
    expect(
      await runEngineNative(["sync", "claude", "--dry-run"], stubServices(environmentRecords)),
    ).toBe(0);

    delete process.env["CLAUDE_COMPACT_WINDOW"];
    const flagRecords: Array<LogRecord> = [];
    expect(
      await runEngineNative(
        ["sync", "claude", "--dry-run", "--claude-compact-window=680k"],
        stubServices(flagRecords),
      ),
    ).toBe(0);

    const compactMessage = (records: Array<LogRecord>): string | undefined =>
      records.find(({ message }) => message.includes("(--claude-compact-window)"))?.message;
    expect(compactMessage(environmentRecords)).toBe(compactMessage(flagRecords));
    expect(compactMessage(environmentRecords)).toContain("CLAUDE_CODE_AUTO_COMPACT_WINDOW=680000");

    process.env["CLAUDE_COMPACT_WINDOW"] = "junk";
    const invalidRecords: Array<LogRecord> = [];
    expect(
      await runEngineNative(["sync", "agents", "--dry-run"], stubServices(invalidRecords)),
    ).toBe(2);
    expect(invalidRecords).toEqual([
      {
        level: "err",
        message: "CLAUDE_COMPACT_WINDOW expects a token count (e.g. 680000 or 680k)",
      },
    ]);
  });

  it("rejects an invalid CLAUDE_PLUGINS token after a valid one", async () => {
    process.env["CLAUDE_PLUGINS"] = "supabase arbitrary n8n";
    const records: Array<LogRecord> = [];

    expect(await runEngineNative(["sync", "agents", "--dry-run"], stubServices(records))).toBe(2);
    expect(records).toEqual([
      {
        level: "err",
        message: "Unknown opt-in plugin 'arbitrary'. Known: supabase, n8n",
      },
    ]);
  });

  it("warns when explicitly supplied Claude modifiers are deselected", async () => {
    const records: Array<LogRecord> = [];

    expect(
      await runEngineNative(
        [
          "sync",
          "agents",
          "--dry-run",
          "--claude-compact-window=680k",
          "--claude-permissive",
          "--claude-plugin=supabase",
        ],
        stubServices(records),
      ),
    ).toBe(0);
    expect(records.filter(({ level }) => level === "warn")).toEqual([
      { level: "warn", message: "--claude-compact-window ignored: claude target not selected" },
      { level: "warn", message: "--claude-permissive ignored: claude target not selected" },
      { level: "warn", message: "--claude-plugin ignored: claude target not selected" },
    ]);
  });

  it.each([
    ["claude", ".claude", "settings.json"],
    ["codex", ".codex", "config.toml"],
  ] as const)("fails when deployed %s configuration cannot be read", async (tool, dir, file) => {
    mkdirSync(join(root, dir, file), { recursive: true });
    const records: Array<LogRecord> = [];

    expect(await runEngineNative(["model", tool], stubServices(records))).toBe(1);
    expect(records).toEqual([
      {
        level: "err",
        message: expect.stringContaining(`Failed to read ~/${dir}/${file}:`),
      },
    ]);
  });

  it.each([
    ["claude", "bogus", ".claude/settings.json", "Invalid Claude model 'bogus'"],
    ["codex", "bad model", ".codex/config.toml", "Invalid Codex model 'bad model'"],
  ] as const)(
    "rejects invalid %s models without changing deployment",
    async (tool, model, file, error) => {
      const records: Array<LogRecord> = [];

      expect(await runEngineNative(["model", tool, model], stubServices(records))).toBe(2);
      expect(records.filter(({ level }) => level === "err")).toEqual([
        { level: "err", message: error },
      ]);
      expect(records).toContainEqual({
        level: "echo",
        message: expect.stringContaining(`Available ${tool} models`),
      });
      expect(existsSync(join(root, file))).toBe(false);
    },
  );

  it.each([
    ["claude", "--claude-model=bogus", ".claude/settings.json", "Invalid Claude model 'bogus'"],
    ["codex", "--codex-model=bad model", ".codex/config.toml", "Invalid Codex model 'bad model'"],
  ] as const)(
    "rejects an invalid %s sync modifier before creating deployment",
    async (tool, flag, file, diagnostic) => {
      const records: Array<LogRecord> = [];

      expect(await runEngineNative(["sync", tool, flag], stubServices(records))).toBe(2);
      expect(records).toContainEqual({
        level: "err",
        message: expect.stringContaining(diagnostic),
      });
      expect(records).toContainEqual({
        level: "echo",
        message: expect.stringContaining(`Available ${tool} models`),
      });
      expect(existsSync(join(root, file))).toBe(false);
    },
  );

  it("ignores flags when selecting a toolchain operation", async () => {
    const records: Array<LogRecord> = [];

    expect(await runEngineNative(["toolchain", "--verbose", "ensure"], stubServices(records))).toBe(
      2,
    );
    expect(records).toEqual([{ level: "err", message: "Usage: toolchain ensure <tool>" }]);
  });
});
