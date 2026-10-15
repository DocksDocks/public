import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Ctx } from "../../src/engine-native";
import { syncMarketplace } from "../../src/engine-native/codexPlugins";
import { DEPENDENCIES } from "../../src/engine-native/deps";
import { p } from "../../src/engine-native/exec";
import { makePlatform, type Logger } from "../../src/engine-native/services";
import { kitHome } from "../../src/kitHome";
import { cleanup, readArgvLog, runEngine } from "../lib/goldenExecution";
import { cleanupTemporaryDirs, makeStubDir } from "../lib/goldenResources";

afterAll(cleanupTemporaryDirs);

type LogLevel = "change" | "verbose" | "warn" | "err" | "echo";
interface LogRecord {
  readonly level: LogLevel;
  readonly message: string;
}

const sotMarketplaceText = readFileSync(
  join(kitHome(), "SoT", ".codex", "plugins", "marketplace.json"),
  "utf8",
);

function testCtx(home: string, records: Array<LogRecord>): Ctx {
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
    services: {
      logger,
      platform: makePlatform("linux"),
      deps: {
        spec: (id) => DEPENDENCIES[id],
        probe: () => ({ state: "missing" as const }),
        version: async () => "",
        path: async () => "",
        warnMissing: () => {},
      },
    },
    failures: [],
  };
}

describe("Codex personal marketplace", () => {
  it("installs a form that the next sync leaves unchanged", () => {
    const home = mkdtempSync(join(tmpdir(), "codex-marketplace-install-"));
    const marketplace = p(home, ".agents", "plugins", "marketplace.json");
    const records: Array<LogRecord> = [];
    const ctx = testCtx(home, records);

    try {
      expect(syncMarketplace(ctx, sotMarketplaceText, marketplace)).toBeUndefined();
      expect(records).toContainEqual({ level: "change", message: "Codex marketplace installed" });
      const installed = readFileSync(marketplace, "utf8");

      records.length = 0;
      ctx.nextStepTriggers.codexRestart = false;
      expect(syncMarketplace(ctx, sotMarketplaceText, marketplace)).toBeUndefined();
      expect(records.filter(({ level }) => level === "change")).toEqual([]);
      expect(ctx.nextStepTriggers.codexRestart).toBe(false);
      expect(readFileSync(marketplace, "utf8")).toBe(installed);
      expect(existsSync(`${marketplace}.bak`)).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("leaves a differently named marketplace alone and adds no kit plugin", () => {
    const fixture = mkdtempSync(join(tmpdir(), "codex-marketplace-personal-"));
    mkdirSync(join(fixture, ".agents", "plugins"), { recursive: true });
    writeFileSync(join(fixture, ".bashrc"), "");
    const personal = `${JSON.stringify(
      {
        name: "personal",
        plugins: [{ name: "my-plugin", source: { source: "local", path: "./plugins/my-plugin" } }],
      },
      null,
      2,
    )}\n`;
    writeFileSync(join(fixture, ".agents", "plugins", "marketplace.json"), personal);
    const nativeHost = { nativeHost: true } as const;
    const run = runEngine(
      ["sync", "codex", "--skip-bubblewrap"],
      fixture,
      makeStubDir({}, nativeHost),
      nativeHost,
    );

    try {
      const deployed = join(run.home, ".agents", "plugins", "marketplace.json");
      expect(run.exitCode, run.output).toBe(0);
      expect(run.output).toContain(
        'Codex personal marketplace <HOME>/.agents/plugins/marketplace.json is named "personal", but kit plugins need "docks".',
      );
      expect(readFileSync(deployed, "utf8")).toBe(personal);
      expect(existsSync(`${deployed}.bak`)).toBe(false);
      expect(readArgvLog(run)).not.toMatch(/^codex\tplugin add /m);
    } finally {
      cleanup([run]);
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
