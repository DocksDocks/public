import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as Payload from "../../src/payload";
import type { PayloadPath } from "../../src/payload";

const mocks = vi.hoisted(() => ({ sotRules: new Map<string, string>() }));

vi.mock("../../src/payload", async () => {
  const actual = await vi.importActual<typeof Payload>("../../src/payload");
  return {
    ...actual,
    payloadBytes: (path: string) => {
      const text = mocks.sotRules.get(path);
      if (text === undefined) throw new Error(`no test payload for ${path}`);
      return new TextEncoder().encode(text);
    },
    payloadDisplayPath: (path: string) => `embedded:${path}`,
  };
});

import { syncRules } from "../../src/engine-native/codexSync";
import type { Ctx } from "../../src/engine-native";
import { DEPENDENCIES } from "../../src/engine-native/deps";
import { p } from "../../src/engine-native/exec";
import { makePlatform, type EngineServices, type Logger } from "../../src/engine-native/services";
import { kitHome } from "../../src/kitHome";

type LogLevel = "change" | "verbose" | "warn" | "err" | "echo";
interface LogRecord {
  readonly level: LogLevel;
  readonly message: string;
}

const KIT_RULES = 'prefix_rule(pattern = ["rm"], decision = "prompt")\n';
const DROPPED_RULES = 'prefix_rule(pattern = ["git", "push"], decision = "prompt")\n';

const roots: Array<string> = [];

afterEach(() => {
  mocks.sotRules.clear();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function testCtx(home: string, records: Array<LogRecord>, dryRun = false): Ctx {
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
    platform: makePlatform("linux"),
    deps: {
      spec: (id) => DEPENDENCIES[id],
      probe: () => ({ state: "missing" as const }),
      version: async () => "",
      versionReading: async () => ({ kind: "version" as const, value: "" }),
      path: async () => "",
      warnMissing: () => {},
    },
  };
  return {
    repoDir: kitHome(),
    home,
    agentsDir: p(home, ".agents"),
    interactive: false,
    dryRun,
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
      ompPluginUpgraded: false,
    },
    services,
    failures: [],
  };
}

/**
 * syncRules joins a rules file name with the slash-stable `exec.ts p`, as every
 * engine path does, so a test that expects a logged path must build it with `p`
 * too. `join` gives a backslash on Windows, and the logged path has a slash.
 */
interface CodexHome {
  readonly home: string;
  readonly rulesDir: string;
  readonly manifest: string;
}

function codexHomeFixture(): CodexHome {
  const home = mkdtempSync(join(tmpdir(), "codex-rules-"));
  roots.push(home);
  const codexDir = join(home, ".codex");
  mkdirSync(codexDir);
  return {
    home,
    rulesDir: join(codexDir, "rules"),
    manifest: join(codexDir, ".kit-managed-rules"),
  };
}

/** Runs one sync with `shipped` as the SoT rules files (name to content). */
function sync(
  fixture: CodexHome,
  shipped: Record<string, string>,
  options: { readonly dryRun?: boolean } = {},
): Array<LogRecord> {
  mocks.sotRules.clear();
  const sotRules: Array<PayloadPath> = [];
  for (const [name, content] of Object.entries(shipped)) {
    const path = `SoT/.codex/rules/${name}` as PayloadPath;
    mocks.sotRules.set(path, content);
    sotRules.push(path);
  }
  const records: Array<LogRecord> = [];
  syncRules(
    testCtx(fixture.home, records, options.dryRun ?? false),
    sotRules,
    fixture.rulesDir,
    fixture.manifest,
  );
  return records;
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

describe("Codex rules deploy", () => {
  it("records the deployed kit rules files", () => {
    const fixture = codexHomeFixture();

    sync(fixture, { "docks.rules": KIT_RULES });

    expect(readFileSync(join(fixture.rulesDir, "docks.rules"), "utf8")).toBe(KIT_RULES);
    expect(readFileSync(fixture.manifest, "utf8")).toBe(`${sha256(KIT_RULES)}  docks.rules\n`);
  });

  it("removes a dropped kit rules file that still holds the kit bytes", () => {
    const fixture = codexHomeFixture();
    sync(fixture, { "docks.rules": KIT_RULES, "old.rules": DROPPED_RULES });
    const dropped = p(fixture.rulesDir, "old.rules");

    const records = sync(fixture, { "docks.rules": KIT_RULES });

    expect(existsSync(dropped)).toBe(false);
    expect(records).toContainEqual({ level: "change", message: expect.stringContaining(dropped) });
    expect(readFileSync(fixture.manifest, "utf8")).toBe(`${sha256(KIT_RULES)}  docks.rules\n`);
  });

  it("keeps a dropped kit rules file that the user edited", () => {
    const fixture = codexHomeFixture();
    sync(fixture, { "docks.rules": KIT_RULES, "old.rules": DROPPED_RULES });
    const dropped = p(fixture.rulesDir, "old.rules");
    const edited = `${DROPPED_RULES}# my note\n`;
    writeFileSync(dropped, edited);
    const expectedManifest = [
      `${sha256(KIT_RULES)}  docks.rules`,
      `${sha256(DROPPED_RULES)}  old.rules`,
      "",
    ].join("\n");

    for (let run = 1; run <= 2; run++) {
      const records = sync(fixture, { "docks.rules": KIT_RULES });

      expect(readFileSync(dropped, "utf8")).toBe(edited);
      expect(records).toContainEqual({ level: "warn", message: expect.stringContaining(dropped) });
      expect(readFileSync(fixture.manifest, "utf8")).toBe(expectedManifest);
    }
  });

  it("never removes a rules file the kit did not write", () => {
    const fixture = codexHomeFixture();
    mkdirSync(fixture.rulesDir);
    const learned = 'prefix_rule(pattern = ["ls"], decision = "allow")\n';
    writeFileSync(join(fixture.rulesDir, "default.rules"), learned);
    writeFileSync(join(fixture.rulesDir, "mine.rules"), KIT_RULES);

    sync(fixture, { "docks.rules": KIT_RULES });
    const records = sync(fixture, { "docks.rules": KIT_RULES });

    expect(readFileSync(join(fixture.rulesDir, "default.rules"), "utf8")).toBe(learned);
    expect(readFileSync(join(fixture.rulesDir, "mine.rules"), "utf8")).toBe(KIT_RULES);
    expect(records.filter(({ level }) => level === "change" || level === "warn")).toEqual([]);
    expect(readFileSync(fixture.manifest, "utf8")).toBe(`${sha256(KIT_RULES)}  docks.rules\n`);
  });

  it("reports a removal under dry run and writes nothing", () => {
    const fixture = codexHomeFixture();
    sync(fixture, { "docks.rules": KIT_RULES, "old.rules": DROPPED_RULES });
    const dropped = p(fixture.rulesDir, "old.rules");
    const manifestBefore = readFileSync(fixture.manifest, "utf8");

    const records = sync(fixture, { "docks.rules": KIT_RULES }, { dryRun: true });

    expect(records).toContainEqual({ level: "echo", message: `[dry-run] remove ${dropped}` });
    expect(readFileSync(dropped, "utf8")).toBe(DROPPED_RULES);
    expect(readFileSync(fixture.manifest, "utf8")).toBe(manifestBefore);
  });
});
