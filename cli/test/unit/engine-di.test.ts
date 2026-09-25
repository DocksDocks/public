import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runBounded, runEngineNative, syncConcurrencyForManifest } from "../../src/engine-native";
import { p } from "../../src/engine-native/exec";
import {
  syncClaudeAdvisor,
  syncClaudeEffort,
} from "../../src/engine-native/claudeSettingsModifiers";
import { syncCodexEffort } from "../../src/engine-native/codexToml";
import { codexNextSteps, codexSummary } from "../../src/engine-native/codexStatus";
import { DEPENDENCIES } from "../../src/engine-native/deps";
import type { Ctx } from "../../src/engine-native";
import {
  makeEngineServices,
  makePlatform,
  type DependencyManager,
  type EngineServices,
  type Logger,
} from "../../src/engine-native/services";
import { skillsNextSteps, skillsSummary } from "../../src/engine-native/skillsSync";
import { sotEffort } from "../../src/efforts";
import { kitHome } from "../../src/kitHome";

type LogLevel = "change" | "verbose" | "warn" | "err" | "echo";
interface LogRecord {
  readonly level: LogLevel;
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
    spec: (id) => DEPENDENCIES[id],
    probe: (id) => ({ state: "present", path: `/stub-bin/${id}` }),
    version: async () => "",
    path: async (id) => `/stub-bin/${id}`,
    warnMissing: () => {},
  };
  return { logger, deps, platform };
}

function modifierCtx(home: string, records: Array<LogRecord>): Ctx {
  return {
    repoDir: kitHome(),
    home,
    agentsDir: p(home, ".agents"),
    interactive: false,
    dryRun: false,
    verbose: true,
    skipBubblewrap: false,
    reconcile: false,
    prune: false,
    claudeCompactWindow: "",
    claudePermissive: false,
    claudePlugins: [],
    claudeModel: "",
    claudeEffort: "",
    claudeAdvisor: "",
    codexModel: "",
    codexEffort: "",
    syncConcurrency: 3,
    services: stubServices(records),
    targetFilterSet: true,
    syncClaude: true,
    syncCodex: false,
    syncAgents: false,
    syncOmp: false,
    nextStepTriggers: {
      claudePlugins: false,
      claudeRestart: false,
      codexRestart: false,
      skillsRestart: false,
      ompRestart: false,
    },
    failures: [],
  };
}

describe("sync pipeline coordinator", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    return { promise, resolve, reject };
  }

  it("serializes Claude and skills only for a populated manifest", () => {
    const manifest = "DocksDocks/example-skill # managed\n";
    expect(syncConcurrencyForManifest(3, manifest, true, true)).toBe(1);
    expect(
      syncConcurrencyForManifest(3, "# comments and blank lines stay empty\n\n", true, true),
    ).toBe(3);
    expect(syncConcurrencyForManifest(3, manifest, false, true)).toBe(3);
    expect(syncConcurrencyForManifest(3, manifest, true, false)).toBe(3);
  });

  it("caps overlap and returns results in selection order", async () => {
    const names = ["Claude", "Codex", "skills"] as const;
    const controls = names.map(() => deferred<string>());
    const thirdStarted = deferred<void>();
    const started: Array<string> = [];
    let active = 0;
    let maxActive = 0;
    const run = runBounded(
      names.map((name, index) => async () => {
        started.push(name);
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (index === 2) thirdStarted.resolve();
        const result = await controls[index]!.promise;
        active -= 1;
        return result;
      }),
      2,
    );
    expect(started).toEqual(["Claude", "Codex"]);
    controls[1]!.resolve("codex-result");
    await thirdStarted.promise;
    expect(active).toBe(2);
    controls[0]!.resolve("claude-result");
    controls[2]!.resolve("skills-result");
    await expect(run).resolves.toEqual(["claude-result", "codex-result", "skills-result"]);
    expect(maxActive).toBe(2);
  });

  it("runs the next pipeline only after the prior one settles at cap one", async () => {
    const first = deferred<number>();
    const secondStarted = deferred<void>();
    const started: Array<string> = [];
    const run = runBounded(
      [
        async () => {
          started.push("first");
          return await first.promise;
        },
        async () => {
          started.push("second");
          secondStarted.resolve();
          return 2;
        },
      ],
      1,
    );
    expect(started).toEqual(["first"]);
    first.resolve(1);
    await secondStarted.promise;
    await expect(run).resolves.toEqual([1, 2]);
  });

  it("drains started pipelines, stops queued work, and reports the first input failure", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const firstFailure = new Error("claude failed");
    let queued = false;
    const run = runBounded(
      [
        async () => await first.promise,
        async () => await second.promise,
        async () => {
          queued = true;
          return "should not run";
        },
      ],
      2,
    );
    const result = expect(run).rejects.toBe(firstFailure);
    second.reject(new Error("codex failed"));
    first.reject(firstFailure);
    await result;
    expect(queued).toBe(false);
  });
});

describe("Claude settings modifiers", () => {
  it("sets effort, resolves default from the embedded SoT, and is idempotent", () => {
    const home = mkdtempSync(join(tmpdir(), "claude-effort-modifier-"));
    const settings = p(home, ".claude", "settings.json");
    mkdirSync(p(home, ".claude"), { recursive: true });
    writeFileSync(settings, '{"model":"sonnet","userOnly":true}\n');
    const records: Array<LogRecord> = [];
    const ctx = modifierCtx(home, records);

    try {
      syncClaudeEffort(ctx, "low");
      expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual({
        model: "sonnet",
        userOnly: true,
        effortLevel: "low",
      });
      expect(records).toContainEqual({
        level: "change",
        message:
          "Effort: deployed settings effortLevel set to low (SoT unchanged; flag-less sync reverts)",
      });

      const deployed = readFileSync(settings, "utf8");
      records.length = 0;
      syncClaudeEffort(ctx, "low");
      expect(readFileSync(settings, "utf8")).toBe(deployed);
      expect(records.filter(({ level }) => level === "change")).toEqual([]);

      syncClaudeEffort(ctx, "default");
      expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual({
        model: "sonnet",
        userOnly: true,
        effortLevel: sotEffort("claude"),
      });
      expect(records).toContainEqual({
        level: "change",
        message: `Effort: deployed settings effortLevel set to ${sotEffort("claude")} (SoT default)`,
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("does not overwrite malformed deployed Claude settings", () => {
    const home = mkdtempSync(join(tmpdir(), "claude-modifier-invalid-"));
    const settings = p(home, ".claude", "settings.json");
    mkdirSync(p(home, ".claude"), { recursive: true });
    writeFileSync(settings, "{broken\n");
    const records: Array<LogRecord> = [];

    try {
      syncClaudeEffort(modifierCtx(home, records), "high");
      expect(readFileSync(settings, "utf8")).toBe("{broken\n");
      expect(records).toContainEqual({
        level: "err",
        message: `(--claude-effort) ${settings} is not valid JSON — skipped`,
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("turns the deployed advisor on and removes it for off and default without losing user keys", () => {
    const home = mkdtempSync(join(tmpdir(), "claude-advisor-"));
    const settings = p(home, ".claude", "settings.json");
    mkdirSync(p(home, ".claude"), { recursive: true });
    writeFileSync(settings, '{"userOnly":true}\n');
    const records: Array<LogRecord> = [];
    const ctx = modifierCtx(home, records);

    try {
      for (const [state, expected] of [
        ["on", { userOnly: true, advisorModel: "opus" }],
        ["off", { userOnly: true }],
        ["on", { userOnly: true, advisorModel: "opus" }],
        ["default", { userOnly: true }],
      ] as const) {
        ctx.nextStepTriggers.claudeRestart = false;
        syncClaudeAdvisor(ctx, state);
        expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual(expected);
        expect(ctx.nextStepTriggers.claudeRestart).toBe(true);
      }

      const unchanged = readFileSync(settings, "utf8");
      ctx.nextStepTriggers.claudeRestart = false;
      syncClaudeAdvisor(ctx, "default");
      expect(readFileSync(settings, "utf8")).toBe(unchanged);
      expect(ctx.nextStepTriggers.claudeRestart).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("Codex effort modifier", () => {
  it("replaces duplicate top-level effort while preserving user settings and no-op runs", () => {
    const home = mkdtempSync(join(tmpdir(), "codex-effort-modifier-"));
    const config = p(home, ".codex", "config.toml");
    mkdirSync(p(home, ".codex"), { recursive: true });
    writeFileSync(
      config,
      '# keep\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "low" # stale\nmodel_reasoning_effort = "medium"\n\n[features]\nmemories = true\n',
    );
    const records: Array<LogRecord> = [];
    const ctx = modifierCtx(home, records);

    try {
      syncCodexEffort(ctx, "ultra");
      const deployed =
        '# keep\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "ultra"\n\n[features]\nmemories = true\n';
      expect(readFileSync(config, "utf8")).toBe(deployed);
      expect(records).toContainEqual({
        level: "change",
        message:
          "Effort: deployed Codex model_reasoning_effort set to ultra (SoT unchanged; flag-less sync reverts)",
      });

      records.length = 0;
      syncCodexEffort(ctx, "ultra");
      expect(readFileSync(config, "utf8")).toBe(deployed);
      expect(records.filter(({ level }) => level === "change")).toEqual([]);

      syncCodexEffort(ctx, "default");
      expect(readFileSync(config, "utf8")).toBe(
        `# keep\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "${sotEffort("codex")}"\n\n[features]\nmemories = true\n`,
      );
      expect(records).toContainEqual({
        level: "change",
        message: `Effort: deployed Codex model_reasoning_effort set to ${sotEffort("codex")} (SoT default)`,
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("keeps missing-file and dry-run behavior non-mutating", () => {
    const home = mkdtempSync(join(tmpdir(), "codex-effort-dry-"));
    const records: Array<LogRecord> = [];
    const ctx = modifierCtx(home, records);
    const config = p(home, ".codex", "config.toml");

    try {
      syncCodexEffort(ctx, "ultra");
      expect(records).toEqual([
        { level: "warn", message: `(--codex-effort) ${config} missing — skipped` },
      ]);
      expect(readdirSync(home)).toEqual([]);

      mkdirSync(p(home, ".codex"), { recursive: true });
      writeFileSync(config, 'model_reasoning_effort = "low"\n');
      records.length = 0;
      ctx.dryRun = true;
      syncCodexEffort(ctx, "ultra");
      expect(readFileSync(config, "utf8")).toBe('model_reasoning_effort = "low"\n');
      expect(records).toEqual([
        {
          level: "echo",
          message: `[dry-run] (--codex-effort) set model_reasoning_effort = "ultra" in ${config}`,
        },
      ]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("Codex sync summary", () => {
  it("counts enabled deployed plugins and recommends a restart only after a change", () => {
    const home = mkdtempSync(join(tmpdir(), "codex-summary-"));
    const config = p(home, ".codex", "config.toml");
    mkdirSync(p(home, ".codex"), { recursive: true });
    writeFileSync(
      config,
      '[plugins."docks@docks"]\nenabled = true\n[plugins."personal@local"]\nenabled = false\n',
    );
    const records: Array<LogRecord> = [];
    const ctx = modifierCtx(home, records);
    ctx.verbose = false;

    try {
      codexSummary(ctx);
      expect(records.filter(({ level }) => level === "echo")).toEqual([
        { level: "echo", message: `Codex:    ${p(home, ".codex")}` },
        { level: "echo", message: "Codex plugins: 1 enabled in config.toml" },
      ]);
      expect(codexNextSteps(ctx)).toEqual([]);

      ctx.nextStepTriggers.codexRestart = true;
      expect(codexNextSteps(ctx)).toEqual([
        "Restart Codex to load any refreshed plugins, skills, or tools.",
      ]);

      ctx.dryRun = true;
      records.length = 0;
      codexSummary(ctx);
      expect(records.filter(({ level }) => level === "echo")).toEqual([
        { level: "echo", message: `Codex:    ${p(home, ".codex")}` },
      ]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("skills sync summary", () => {
  it("reports the installed count only for a real sync and advises a restart after changes", () => {
    const records: Array<LogRecord> = [];
    const ctx = modifierCtx("/fixture-home", records);
    ctx.verbose = false;

    skillsSummary(ctx, { present: 2 });
    expect(records.filter(({ level }) => level === "echo")).toEqual([
      { level: "echo", message: `Skills:   ${p(ctx.agentsDir, "skills")}` },
      { level: "echo", message: "          2 universal skill(s) installed" },
    ]);
    expect(skillsNextSteps(ctx)).toEqual([]);

    ctx.nextStepTriggers.skillsRestart = true;
    expect(skillsNextSteps(ctx)).toEqual([
      "Restart Claude Code (and Codex) to discover newly installed universal skills.",
    ]);
    ctx.dryRun = true;
    records.length = 0;
    skillsSummary(ctx, { present: 2 });
    expect(records.filter(({ level }) => level === "echo")).toEqual([
      { level: "echo", message: `Skills:   ${p(ctx.agentsDir, "skills")}` },
    ]);
  });
});

describe("native CLI argument and output behavior", () => {
  async function withIsolatedHome(run: (home: string) => Promise<void>): Promise<void> {
    const home = mkdtempSync(join(tmpdir(), "engine-di-"));
    const keys = [
      "HOME",
      "AGENTS_DIR",
      "DOCKS_KIT_HOME",
      "DRY_RUN",
      "DOCKS_KIT_VERBOSE",
      "DOCKS_KIT_INTERACTIVE",
      "DOCKS_KIT_SYNC_CONCURRENCY",
      "SKIP_BUBBLEWRAP",
      "RECONCILE",
      "PRUNE",
      "CLAUDE_COMPACT_WINDOW",
      "CLAUDE_PERMISSIVE",
      "CLAUDE_PLUGINS",
      "CLAUDE_MODEL",
      "CODEX_MODEL",
    ] as const;
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]])) as Record<
      (typeof keys)[number],
      string | undefined
    >;
    try {
      for (const key of keys) delete process.env[key];
      process.env["HOME"] = home;
      process.env["AGENTS_DIR"] = p(home, ".agents");
      process.env["DOCKS_KIT_INTERACTIVE"] = "0";
      await run(home);
    } finally {
      for (const key of keys) {
        const value = previous[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(home, { recursive: true, force: true });
    }
  }

  it("lists the effort and advisor value grammars in sync help", async () => {
    await withIsolatedHome(async () => {
      const stdout: Array<string> = [];
      const stderr: Array<string> = [];
      const services = makeEngineServices({
        sinks: {
          stdout: (chunk) => void stdout.push(chunk),
          stderr: (chunk) => void stderr.push(chunk),
        },
      });
      expect(await runEngineNative(["sync", "--help"], services)).toBe(0);
      const help = stdout.join("");
      expect(help).toContain("--claude-effort=<low|medium|high|xhigh|default>");
      expect(help).toContain(
        "--codex-effort=<none|minimal|low|medium|high|xhigh|max|ultra|default>",
      );
      expect(help).toContain("--claude-advisor=<on|off|default>");
      expect(stderr).toEqual([]);
    });
  });

  it("reports the deployed and SoT Claude models on stdout", async () => {
    await withIsolatedHome(async (home) => {
      mkdirSync(p(home, ".claude"), { recursive: true });
      writeFileSync(p(home, ".claude", "settings.json"), '{"model":"sonnet"}\n');
      const stdout: Array<string> = [];
      const stderr: Array<string> = [];
      const services = makeEngineServices({
        sinks: {
          stdout: (chunk) => void stdout.push(chunk),
          stderr: (chunk) => void stderr.push(chunk),
        },
      });
      expect(await runEngineNative(["model", "claude"], services)).toBe(0);
      expect(stdout.slice(0, 2)).toEqual(["deployed: sonnet\n", "SoT:      opus\n"]);
      expect(stdout.join("")).toContain("Available claude models");
      expect(stderr).toEqual([]);
    });
  });

  it("rejects unsupported effort and advisor values before touching the home", async () => {
    await withIsolatedHome(async (home) => {
      for (const [target, flag, catalog, error] of [
        [
          "claude",
          "--claude-effort=max",
          "Available claude effort levels",
          "Invalid Claude effort 'max'",
        ],
        [
          "codex",
          "--codex-effort=future",
          "Available codex effort levels",
          "Invalid Codex effort 'future'",
        ],
        [
          "claude",
          "--claude-advisor=maybe",
          "Available claude advisor states",
          "Invalid Claude advisor state 'maybe'",
        ],
      ] as const) {
        const records: Array<LogRecord> = [];
        expect(await runEngineNative(["sync", target, flag], stubServices(records))).toBe(2);
        expect(
          records
            .filter(({ level }) => level === "echo")
            .map(({ message }) => message)
            .join("\n"),
        ).toContain(catalog);
        expect(records).toContainEqual({
          level: "err",
          message: expect.stringContaining(error),
        });
      }
      expect(readdirSync(home)).toEqual([]);
    });
  });

  it("rejects inline and separate explicit-empty scalar values without changing files", async () => {
    await withIsolatedHome(async (home) => {
      for (const [target, flag, catalog, error] of [
        ["claude", "--claude-effort", "Available claude effort levels", "Invalid Claude effort ''"],
        ["codex", "--codex-model", "Available codex models", "Invalid Codex model ''"],
      ] as const) {
        for (const args of [[`${flag}=`], [flag, ""]]) {
          const records: Array<LogRecord> = [];
          expect(await runEngineNative(["sync", target, ...args], stubServices(records))).toBe(2);
          expect(
            records
              .filter(({ level }) => level === "echo")
              .map(({ message }) => message)
              .join("\n"),
          ).toContain(catalog);
          expect(records).toContainEqual({
            level: "err",
            message: expect.stringContaining(error),
          });
        }
      }
      expect(readdirSync(home)).toEqual([]);
    });
  });

  it("rejects values on the boolean permissive modifier", async () => {
    await withIsolatedHome(async (home) => {
      const records: Array<LogRecord> = [];
      expect(
        await runEngineNative(["sync", "claude", "--claude-permissive="], stubServices(records)),
      ).toBe(2);
      expect(records).toContainEqual({
        level: "err",
        message: "--claude-permissive does not take a value",
      });
      expect(readdirSync(home)).toEqual([]);
    });
  });

  it("warns and ignores effort and advisor modifiers for unselected targets", async () => {
    await withIsolatedHome(async () => {
      const records: Array<LogRecord> = [];
      expect(
        await runEngineNative(
          [
            "sync",
            "agents",
            "--dry-run",
            "--claude-effort=low",
            "--claude-advisor=on",
            "--codex-effort=max",
          ],
          stubServices(records),
        ),
      ).toBe(0);
      expect(records.filter(({ level }) => level === "warn")).toEqual([
        { level: "warn", message: "--claude-effort ignored: claude target not selected" },
        { level: "warn", message: "--claude-advisor ignored: claude target not selected" },
        { level: "warn", message: "--codex-effort ignored: codex target not selected" },
      ]);
    });
  });

  it("prints a no-change model confirmation only for a verbose run", async () => {
    await withIsolatedHome(async (home) => {
      const stderr: Array<string> = [];
      const stdout: Array<string> = [];
      const factory = makeEngineServices({
        sinks: {
          stderr: (chunk) => void stderr.push(chunk),
          stdout: (chunk) => void stdout.push(chunk),
        },
      });
      const services = { ...factory, deps: stubServices([]).deps };
      mkdirSync(p(home, ".claude"), { recursive: true });
      writeFileSync(p(home, ".claude", "settings.json"), "{}\n");

      expect(await runEngineNative(["model", "claude", "default"], services)).toBe(0);
      expect(await runEngineNative(["model", "claude", "default", "--verbose"], services)).toBe(0);
      expect(await runEngineNative(["model", "claude", "default"], services)).toBe(0);
      expect(stderr).toEqual([
        "\x1b[1;32m[ok]\x1b[0m Model: deployed settings model already unset (account default)\n",
      ]);
      expect(stdout).toEqual([]);
    });
  });
});
