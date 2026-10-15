import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync as nodeSpawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { syncConfig } from "../../src/engine-native/codexConfig";
import { codexSync } from "../../src/engine-native/codexSync";
import { p } from "../../src/engine-native/exec";
import { syncCodexEffort, syncCodexModel } from "../../src/engine-native/codexToml";
import type { Ctx } from "../../src/engine-native";
import { DEPENDENCIES } from "../../src/engine-native/deps";
import { makePlatform, type EngineServices, type Logger } from "../../src/engine-native/services";
import { kitHome } from "../../src/kitHome";

type LogLevel = "change" | "verbose" | "warn" | "err" | "echo";
interface LogRecord {
  readonly level: LogLevel;
  readonly message: string;
}

function testCtx(root: string, records: Array<LogRecord> = []): Ctx {
  const home = join(root, "home");
  const platform = makePlatform("darwin");
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
  const services: EngineServices = {
    logger,
    platform,
    deps: {
      spec: (id) => DEPENDENCIES[id],
      probe: () => ({ state: "missing" as const }),
      version: async () => "",
      path: async () => "",
      warnMissing: () => {},
    },
  };
  return {
    repoDir: kitHome(),
    home,
    agentsDir: p(home, ".agents"),
    interactive: false,
    dryRun: false,
    verbose: false,
    skipBubblewrap: false,
    skipPluginRefresh: false,
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
    targetFilterSet: true,
    syncClaude: false,
    syncCodex: true,
    syncAgents: false,
    syncOmp: false,
    nextStepTriggers: {
      claudePlugins: false,
      claudeRestart: false,
      codexRestart: false,
      skillsRestart: false,
      ompRestart: false,
    },
    services,
    failures: [],
  };
}

function prepareConfig(root: string, content: string): string {
  const home = join(root, "home");
  const config = p(home, ".codex", "config.toml");
  mkdirSync(p(home, ".codex"), { recursive: true });
  writeFileSync(config, content);
  return config;
}

function parseToml(content: string): Record<string, unknown> {
  const parsed = nodeSpawnSync(
    "bun",
    ["-e", "console.log(JSON.stringify(Bun.TOML.parse(await Bun.stdin.text())))"],
    {
      input: content,
      encoding: "utf8",
    },
  );
  expect(parsed.status, parsed.stderr).toBe(0);
  return JSON.parse(parsed.stdout) as Record<string, unknown>;
}

const sotConfig = readFileSync(join(kitHome(), "SoT", ".codex", "config.toml"), "utf8");
const TOML_FIXTURES = join(kitHome(), "cli", "test", "fixtures", "codex-toml");

describe("Codex TOML merge durability", () => {
  // codexHome reads CODEX_HOME; a value from the invoking shell must not move test writes.
  beforeEach(() => {
    vi.stubEnv("CODEX_HOME", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("merges a CRLF config into valid TOML with the managed plugins", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-crlf-merge-"));
    const config = prepareConfig(root, sotConfig.replace(/\n/g, "\r\n"));

    try {
      await codexSync(testCtx(root));
      const deployed = readFileSync(config, "utf8");

      expect(parseToml(deployed)["plugins"]).toEqual({
        "docks@docks": { enabled: true },
        "plan-lifecycle@docks": { enabled: true },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("replaces the user Windows sandbox table with the SoT elevated sandbox", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-windows-merge-"));
    const config = prepareConfig(
      root,
      'model = "user-choice"\n\n[windows]\nsandbox = "unelevated"\nuser_override = true\n',
    );

    try {
      await codexSync(testCtx(root));
      const deployed = readFileSync(config, "utf8");

      expect(parseToml(deployed)["windows"]).toEqual({ sandbox: "elevated" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["a commented header", "[tui] # keep this note", "[tui]", "status_line_use_colors"],
    ["a whitespace-padded header", "[ tui ]", "[tui]", "status_line_use_colors"],
    ["a trailing-space header", "[tui] ", "[tui]", "status_line_use_colors"],
    ["a single-quoted plugin key", "[plugins.'docks@docks']", '[plugins."docks@docks"]', "enabled"],
  ])(
    "recognizes %s as the managed table instead of duplicating it",
    async (_label, userHeader, sotHeader, setting) => {
      const root = mkdtempSync(join(tmpdir(), "codex-header-merge-"));
      const userOverride = `${setting} = false`;
      const managedSetting = `${setting} = true`;
      const config = prepareConfig(
        root,
        sotConfig.replace(`${sotHeader}\n${managedSetting}`, `${userHeader}\n${userOverride}`),
      );

      try {
        await codexSync(testCtx(root));
        const deployed = readFileSync(config, "utf8");

        expect(parseToml(deployed)).toMatchObject(
          setting === "enabled"
            ? { plugins: { "docks@docks": { enabled: true } } }
            : { tui: { status_line_use_colors: true } },
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("rejects invalid deployed marketplace JSON without overwriting it", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-invalid-marketplace-"));
    const home = join(root, "home");
    const marketplace = p(home, ".agents", "plugins", "marketplace.json");
    mkdirSync(p(home, ".agents", "plugins"), { recursive: true });
    writeFileSync(marketplace, "{ invalid");

    try {
      await expect(codexSync(testCtx(root))).rejects.toThrow(
        `invalid deployed Codex marketplace JSON: ${marketplace}. Fix or delete it.`,
      );
      expect(readFileSync(marketplace, "utf8")).toBe("{ invalid");
      expect(existsSync(`${marketplace}.bak`)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("propagates a non-ENOENT Codex config read failure", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-config-read-error-"));
    const config = p(join(root, "home"), ".codex", "config.toml");
    mkdirSync(config, { recursive: true });

    try {
      expect(() => syncCodexEffort(testCtx(root), "high")).toThrow(/EISDIR|EPERM/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("deploys to CODEX_HOME when it is set and to ~/.codex when it is empty", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-home-env-"));
    const relocated = join(root, "alt");
    const defaultCodexDir = p(join(root, "home"), ".codex");

    try {
      vi.stubEnv("CODEX_HOME", relocated);
      await codexSync(testCtx(root));
      expect(existsSync(p(relocated, "config.toml"))).toBe(true);
      expect(existsSync(p(relocated, "rules", "docks.rules"))).toBe(true);
      expect(existsSync(defaultCodexDir)).toBe(false);

      vi.stubEnv("CODEX_HOME", "");
      await codexSync(testCtx(root));
      expect(existsSync(p(defaultCodexDir, "config.toml"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "keeps a 0600 config private through the merge and the model edit",
    () => {
      const root = mkdtempSync(join(tmpdir(), "codex-config-mode-"));
      const config = prepareConfig(root, '[mcp_servers.gh]\nenv = { TOKEN = "secret" }\n');
      chmodSync(config, 0o600);

      try {
        const ctx = testCtx(root);
        syncConfig(ctx, sotConfig, config);
        expect(readFileSync(`${config}.bak`, "utf8")).toContain("TOKEN");
        expect(statSync(config).mode & 0o777).toBe(0o600);

        syncCodexModel(ctx, "gpt-5.5");
        expect(readFileSync(config, "utf8")).toContain('model = "gpt-5.5"');
        expect(statSync(config).mode & 0o777).toBe(0o600);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each([
    ["a top-level key", '\uFEFFmodel = "mine"\n\n[mcp_servers.x]\ncommand = "x"\n', /^model =/gm],
    ["a first table", "\uFEFF[tui]\nnotifications = true\n", /^\[tui\]$/gm],
  ])("merges a BOM-prefixed config that starts with %s", (_label, content, firstLine) => {
    const root = mkdtempSync(join(tmpdir(), "codex-bom-merge-"));
    const config = prepareConfig(root, content);

    try {
      syncConfig(testCtx(root), sotConfig, config);
      const deployed = readFileSync(config, "utf8");

      expect(deployed.match(firstLine)).toHaveLength(1);
      expect(parseToml(deployed)["model"]).toBe(parseToml(sotConfig)["model"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["--codex-model", { codexModel: "gpt-5.5" }],
    ["--codex-effort", { codexEffort: "low" }],
  ])("announces %s once and keeps the backup when it runs again", async (_flag, modifier) => {
    const root = mkdtempSync(join(tmpdir(), "codex-modifier-replay-"));
    const preKit = 'model = "pre-kit"\nmodel_reasoning_effort = "medium"\n';
    const config = prepareConfig(root, preKit);
    const records: Array<LogRecord> = [];
    const ctx: Ctx = { ...testCtx(root, records), ...modifier };

    try {
      await codexSync(ctx);
      expect(readFileSync(`${config}.bak`, "utf8")).toBe(preKit);
      expect(
        records.filter(
          ({ level, message }) =>
            level === "change" && message.includes("(SoT unchanged; flag-less sync reverts)"),
        ),
      ).toHaveLength(1);

      records.length = 0;
      ctx.nextStepTriggers.codexRestart = false;
      await codexSync(ctx);
      expect(records.filter(({ level }) => level === "change")).toEqual([]);
      expect(ctx.nextStepTriggers.codexRestart).toBe(false);
      expect(readFileSync(`${config}.bak`, "utf8")).toBe(preKit);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps a multi-line string that holds header-like lines", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-multiline-merge-"));
    const content = readFileSync(join(TOML_FIXTURES, "08-multiline-string.toml"), "utf8");
    const stringBlock = content.slice(0, content.indexOf('\n"""\n') + 5);
    const config = prepareConfig(root, content);

    try {
      syncConfig(testCtx(root), sotConfig, config);
      const deployed = readFileSync(config, "utf8");
      const parsed = parseToml(deployed);

      expect(deployed.startsWith(stringBlock)).toBe(true);
      expect(parsed["developer_instructions"]).toBe(parseToml(content)["developer_instructions"]);
      expect(parsed["model"]).toBe(parseToml(sotConfig)["model"]);
      expect(parsed["mcp_servers"]).toEqual({ x: { command: "x" } });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps comment lines that follow a replaced managed table", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-comment-merge-"));
    const content = readFileSync(join(TOML_FIXTURES, "09-comment-after-managed.toml"), "utf8");
    const config = prepareConfig(root, content);

    try {
      syncConfig(testCtx(root), sotConfig, config);
      const deployed = readFileSync(config, "utf8");
      const parsed = parseToml(deployed);

      expect(deployed).toContain(
        '# Old server, re-enable when needed\n# [mcp_servers.old]\n# command = "old"\n',
      );
      expect(parsed["agents"]).toEqual(parseToml(sotConfig)["agents"]);
      expect(parsed["mcp_servers"]).toEqual({ x: { command: "x" } });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["the retired kit value", 'personality = "pragmatic"', undefined],
    ["a user-set value", 'personality = "friendly"', "friendly"],
  ])("handles a deployed top-level personality with %s", (_label, line, expected) => {
    const root = mkdtempSync(join(tmpdir(), "codex-retired-setting-"));
    const config = prepareConfig(
      root,
      `model = "mine"\n${line}\n\n[custom]\npersonality = "pragmatic"\n`,
    );
    const records: Array<LogRecord> = [];

    try {
      syncConfig(testCtx(root, records), sotConfig, config);
      const parsed = parseToml(readFileSync(config, "utf8"));

      expect(parsed["personality"]).toBe(expected);
      expect(parsed["custom"]).toEqual({ personality: "pragmatic" });
      expect(
        records.some(
          ({ message }) =>
            message === 'Codex: removed retired top-level setting personality = "pragmatic"',
        ),
      ).toBe(expected === undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
