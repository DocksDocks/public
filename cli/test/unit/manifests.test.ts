import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync as nodeSpawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Payload from "../../src/payload";

const mocks = vi.hoisted<{
  home: string;
  codexConfig: string | undefined;
  claudeSettings: string | undefined;
  skillsManifest: string | undefined;
}>(() => ({
  home: "",
  codexConfig: undefined,
  claudeSettings: undefined,
  skillsManifest: undefined,
}));

vi.mock("../../src/payload", async () => {
  const actual = await vi.importActual<typeof Payload>("../../src/payload");
  return {
    ...actual,
    payloadText: (path: Parameters<typeof actual.payloadText>[0]) => {
      if (path === "SoT/.codex/config.toml" && mocks.codexConfig !== undefined)
        return mocks.codexConfig;
      if (path === "SoT/.claude/settings.json" && mocks.claudeSettings !== undefined)
        return mocks.claudeSettings;
      if (path === "SoT/.agents/skills.txt" && mocks.skillsManifest !== undefined)
        return mocks.skillsManifest;
      return actual.payloadText(path);
    },
  };
});

import { sotEffort } from "../../src/efforts";
import {
  deployedCodexModel,
  installedPluginsState,
  pluginsView,
  skillsView,
  sotCodexModel,
  topLevelTomlString,
} from "../../src/manifests";

function parseToml(content: string): Record<string, unknown> {
  const parsed = nodeSpawnSync(
    "bun",
    ["-e", "console.log(JSON.stringify(Bun.TOML.parse(await Bun.stdin.text())))"],
    { input: content, encoding: "utf8" },
  );
  expect(parsed.status, parsed.stderr).toBe(0);
  return JSON.parse(parsed.stdout) as Record<string, unknown>;
}

beforeEach(() => {
  mocks.home = mkdtempSync(join(tmpdir(), "docks-manifests-"));
  vi.stubEnv("HOME", mocks.home);
  vi.stubEnv("USERPROFILE", mocks.home);
  vi.stubEnv("CODEX_HOME", "");
  mocks.codexConfig = undefined;
  mocks.claudeSettings = undefined;
  mocks.skillsManifest = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(mocks.home, { recursive: true, force: true });
  mocks.home = "";
});

describe("manifest resolvers", () => {
  it("reads a top-level TOML literal string", () => {
    const toml = "model = 'x'\n";
    expect(topLevelTomlString(toml, "model")).toBe("x");
    expect(parseToml(toml)["model"]).toBe("x");
  });

  it("preserves backslashes in a TOML literal string", () => {
    const value = String.raw`C:\models\new`;
    const toml = `model = '${value}'\n`;
    expect(topLevelTomlString(toml, "model")).toBe(value);
    expect(parseToml(toml)["model"]).toBe(value);
  });

  it("reads only the top-level Codex model, even when a profile overrides it", () => {
    mocks.codexConfig = 'model = "top-model"\n[profiles.audit]\nmodel = "table-model"\n';
    expect(sotCodexModel()).toBe("top-model");

    mocks.codexConfig = '[profiles.audit]\nmodel = "table-model"\n';
    expect(sotCodexModel()).toBeUndefined();
  });

  it("does not use a profile effort as the Codex default", () => {
    mocks.codexConfig =
      'model_reasoning_effort = "high"\n[profiles.audit]\nmodel_reasoning_effort = "low"\n';
    expect(sotEffort("codex")).toBe("high");

    mocks.codexConfig = '[profiles.audit]\nmodel_reasoning_effort = "high"\n';
    expect(() => sotEffort("codex")).toThrow(
      "Embedded SoT Codex model_reasoning_effort is missing",
    );
  });

  it("reports SoT enablement separately from user-scope installation", () => {
    mocks.claudeSettings = JSON.stringify({
      enabledPlugins: {
        "disabled@test": false,
        "enabled@test": true,
        "project-only@test": true,
      },
    });
    const pluginsDir = join(mocks.home, ".claude", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(
      join(pluginsDir, "installed_plugins.json"),
      JSON.stringify({
        plugins: {
          "disabled@test": [{ scope: "user" }],
          "project-only@test": [{ scope: "project" }],
          "user@test": [{ scope: "project" }, { scope: "user" }],
        },
      }),
    );

    expect(pluginsView()).toEqual([
      { plugin: "disabled@test", sot: "false", installed: true },
      { plugin: "enabled@test", sot: "true", installed: false },
      { plugin: "project-only@test", sot: "true", installed: false },
      { plugin: "user@test", sot: "absent", installed: true },
    ]);
  });

  it("distinguishes declared, installed, and correctly linked skills", () => {
    mocks.skillsManifest = "# ignored\nowner/repo/declared\nowner/repo/valid\n";
    const agentsSkills = join(mocks.home, ".agents", "skills");
    const claudeSkills = join(mocks.home, ".claude", "skills");
    for (const skill of ["dangling", "valid", "wrong"]) {
      mkdirSync(join(agentsSkills, skill), { recursive: true });
    }
    mkdirSync(claudeSkills, { recursive: true });
    symlinkSync(join(agentsSkills, "missing"), join(claudeSkills, "dangling"), "dir");
    symlinkSync("../../.agents/skills/valid", join(claudeSkills, "valid"), "dir");
    symlinkSync(join(agentsSkills, "valid"), join(claudeSkills, "wrong"), "dir");

    expect(skillsView()).toEqual([
      { skill: "dangling", declared: false, installed: true, claudeSymlink: false },
      { skill: "declared", declared: true, installed: false, claudeSymlink: false },
      { skill: "valid", declared: true, installed: true, claudeSymlink: true },
      { skill: "wrong", declared: false, installed: true, claudeSymlink: false },
    ]);
  });

  it("reports SoT plugins as not installed when installed_plugins.json is malformed", () => {
    mocks.claudeSettings = JSON.stringify({ enabledPlugins: { "enabled@test": true } });
    const pluginsDir = join(mocks.home, ".claude", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    const installedPath = join(pluginsDir, "installed_plugins.json");
    expect(installedPluginsState()).toBe("absent");

    for (const content of ['{"plugins": {', "null", '{"plugins": null}']) {
      writeFileSync(installedPath, content);
      expect(pluginsView()).toEqual([{ plugin: "enabled@test", sot: "true", installed: false }]);
      expect(installedPluginsState()).toBe("malformed");
    }

    writeFileSync(installedPath, JSON.stringify({ plugins: {} }));
    expect(installedPluginsState()).toBe("valid");
  });

  it("names a declared skill after the @skill part of an owner/repo@skill slug", () => {
    mocks.skillsManifest = "acme/pack@Demo\n";
    const agentsSkills = join(mocks.home, ".agents", "skills");
    const claudeSkills = join(mocks.home, ".claude", "skills");
    mkdirSync(join(agentsSkills, "demo"), { recursive: true });
    mkdirSync(claudeSkills, { recursive: true });
    symlinkSync(join(agentsSkills, "demo"), join(claudeSkills, "demo"), "dir");

    expect(skillsView()).toEqual([
      { skill: "demo", declared: true, installed: true, claudeSymlink: true },
    ]);
  });

  it("reads the deployed Codex model from CODEX_HOME when it is set", () => {
    const homeCodex = join(mocks.home, ".codex");
    const altCodex = join(mocks.home, "alt");
    mkdirSync(homeCodex, { recursive: true });
    mkdirSync(altCodex, { recursive: true });
    writeFileSync(join(homeCodex, "config.toml"), 'model = "home-model"\n');
    writeFileSync(join(altCodex, "config.toml"), 'model = "alt-model"\n');

    expect(deployedCodexModel()).toBe("home-model");
    vi.stubEnv("CODEX_HOME", altCodex);
    expect(deployedCodexModel()).toBe("alt-model");
  });
});
