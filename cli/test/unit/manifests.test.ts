import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type * as NodeOs from "node:os";
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

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof NodeOs>("node:os");
  return { ...actual, homedir: () => mocks.home };
});

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
import { pluginsView, skillsView, sotCodexModel } from "../../src/manifests";

beforeEach(() => {
  mocks.home = mkdtempSync(join(tmpdir(), "docks-manifests-"));
  mocks.codexConfig = undefined;
  mocks.claudeSettings = undefined;
  mocks.skillsManifest = undefined;
});

afterEach(() => {
  rmSync(mocks.home, { recursive: true, force: true });
  mocks.home = "";
});

describe("manifest resolvers", () => {
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
});
