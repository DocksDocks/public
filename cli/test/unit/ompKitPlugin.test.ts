import { afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Ctx } from "../../src/engine-native";
import { DEPENDENCIES } from "../../src/engine-native/deps";
import { p } from "../../src/engine-native/exec";
import { makeLogger } from "../../src/engine-native/logger";
import { kitPluginDir, syncKitPlugin } from "../../src/engine-native/ompKitPlugin";
import { makePlatform, type EngineServices } from "../../src/engine-native/services";
import { GENERATED_PACKAGE_VERSION } from "../../src/generated/sotPayload";
import { kitHome } from "../../src/kitHome";
import { payloadText } from "../../src/payload";

const roots: Array<string> = [];

function testCtx(dryRun = false, stdout: Array<string> = [], stderr: Array<string> = []): Ctx {
  const root = mkdtempSync(join(tmpdir(), "omp-kit-plugin-"));
  roots.push(root);
  const home = p(root, "home");
  const services: EngineServices = {
    logger: makeLogger({
      stderr: (chunk) => stderr.push(chunk),
      progress: () => {},
      stdout: (chunk) => stdout.push(chunk),
    }),
    platform: makePlatform("linux"),
    deps: {
      spec: (id) => DEPENDENCIES[id],
      probe: vi.fn(() => ({ state: "missing" as const })),
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
    syncCodex: false,
    syncAgents: false,
    syncOmp: true,
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

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("omp kit plugin files", () => {
  it("writes the plugin package with the kit version and private modes", () => {
    const ctx = testCtx();
    syncKitPlugin(ctx);

    const pluginDir = kitPluginDir(ctx.home);
    const manifest = JSON.parse(readFileSync(join(pluginDir, "package.json"), "utf8")) as {
      name: string;
      version: string;
      omp: { extensions: Array<string> };
    };
    expect(manifest.name).toBe("docks-kit-omp");
    expect(manifest.version).toBe(GENERATED_PACKAGE_VERSION);
    expect(manifest.omp.extensions).toEqual(["./extensions/hygiene.ts"]);
    expect(readFileSync(join(pluginDir, "extensions", "hygiene.ts"), "utf8")).toBe(
      payloadText("SoT/.omp/plugin/extensions/hygiene.ts"),
    );
    expect(
      readFileSync(join(pluginDir, "skills", "workspace-hygiene", "SKILL.md"), "utf8"),
    ).toContain("# Workspace hygiene");
    expect(existsSync(join(pluginDir, "commands", "cleanup.md"))).toBe(true);
    expect(ctx.nextStepTriggers.ompRestart).toBe(true);
  });

  it.skipIf(process.platform === "win32")("keeps files at 0600 and directories at 0700", () => {
    const ctx = testCtx();
    syncKitPlugin(ctx);

    const pluginDir = kitPluginDir(ctx.home);
    expect(statSync(pluginDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(pluginDir, "extensions")).mode & 0o777).toBe(0o700);
    expect(statSync(join(pluginDir, "package.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(pluginDir, "extensions", "hygiene.ts")).mode & 0o777).toBe(0o600);
  });

  it("removes stale files and empty directories from the plugin directory", () => {
    const ctx = testCtx();
    const pluginDir = kitPluginDir(ctx.home);
    mkdirSync(join(pluginDir, "extensions"), { recursive: true });
    writeFileSync(join(pluginDir, "extensions", "old.ts"), "export default () => {};\n");
    mkdirSync(join(pluginDir, "retired", "nested"), { recursive: true });
    writeFileSync(join(pluginDir, "retired", "nested", "file.md"), "old\n");

    syncKitPlugin(ctx);

    expect(existsSync(join(pluginDir, "extensions", "old.ts"))).toBe(false);
    expect(existsSync(join(pluginDir, "retired"))).toBe(false);
    expect(existsSync(join(pluginDir, "extensions", "hygiene.ts"))).toBe(true);
  });

  it("changes nothing on a second run", () => {
    const ctx = testCtx();
    syncKitPlugin(ctx);
    ctx.nextStepTriggers.ompRestart = false;

    syncKitPlugin(ctx);

    expect(ctx.nextStepTriggers.ompRestart).toBe(false);
  });

  it("names the kit plugin version change when the deployed version differs", () => {
    const stderr: Array<string> = [];
    const ctx = testCtx(false, [], stderr);
    const pluginDir = kitPluginDir(ctx.home);
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "package.json"), '{ "version": "0.0.1" }\n');

    syncKitPlugin(ctx);

    expect(stderr.join("")).toContain(
      `omp kit plugin files synced (docks-kit-omp 0.0.1 -> ${GENERATED_PACKAGE_VERSION})`,
    );
  });

  it("previews each file in a dry run and writes nothing", () => {
    const stdout: Array<string> = [];
    const ctx = testCtx(true, stdout);
    syncKitPlugin(ctx);

    const pluginDir = kitPluginDir(ctx.home);
    const lines = stdout.join("").split("\n");
    expect(lines).toContain(
      `[dry-run] cp embedded:SoT/.omp/plugin/package.json -> ${pluginDir}/package.json`,
    );
    expect(lines).toContain(
      `[dry-run] cp embedded:SoT/.omp/plugin/extensions/hygiene.ts -> ${pluginDir}/extensions/hygiene.ts`,
    );
    expect(lines.filter((line) => line.startsWith("[dry-run] cp "))).toHaveLength(4);
    expect(existsSync(pluginDir)).toBe(false);
  });
});
