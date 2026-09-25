import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import type { Ctx } from "../../src/engine-native";
import { syncRemovals } from "../../src/engine-native/claudeRemovals";
import { claudeRuntimePaths } from "../../src/engine-native/claudeRuntime";
import { isObject, parseJson, type Json } from "../../src/engine-native/jq";
import { makeEngineServices } from "../../src/engine-native/services";
import { cleanup, readArgvLog, runEngine, type EngineRun } from "../lib/goldenExecution";
import { cleanupTemporaryDirs, makeStubDir, materializeVariant } from "../lib/goldenResources";
import { stableStringify } from "../lib/goldenSnapshot";

// The stub launchers and the child must agree on one host. Native pairing runs
// the real host with its own launcher form, so these cases keep their
// harness-CLI coverage on Windows instead of resolving a shell script the
// host cannot execute.
const NATIVE = { nativeHost: true } as const;

afterAll(cleanupTemporaryDirs);

const LEGACY_SETTINGS: { [key: string]: Json } = {
  hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: "legacy-session", timeout: 5 }] }],
    Notification: [
      { hooks: [{ type: "command", command: "legacy-notify", timeout: 10, async: true }] },
    ],
    Stop: [{ hooks: [{ type: "command", command: "legacy-fetch", timeout: 5, async: true }] }],
  },
  statusLine: { type: "command", command: "legacy-statusline", refreshInterval: 5 },
  userOnly: "preserved",
};

const LEGACY_FILES = {
  ".claude/statusline.sh": "legacy-statusline-marker\n",
  ".claude/fetch-usage.sh": "legacy-fetch-marker\n",
  ".claude/hooks/notify.sh": "legacy-notify-marker\n",
} as const;

const RUNTIME_FILES = [
  ".claude/bin/statusline.mjs",
  ".claude/bin/session-start.mjs",
  ".claude/bin/notify.mjs",
  ".claude/notification.mp3",
] as const;

function legacyVariant(settings = stableStringify(LEGACY_SETTINGS)): string {
  return materializeVariant("home-fresh", {
    ".claude/settings.json": settings,
    ...LEGACY_FILES,
  });
}

function runWithBunUnavailable(args: ReadonlyArray<string>, home: string): EngineRun {
  const stubs = makeStubDir({ bun: null, curl: null }, NATIVE);
  return runEngine(args, home, stubs, { ...NATIVE, reuseHome: home, env: { PATH: stubs } });
}

function settingsObject(home: string): { [key: string]: Json } {
  const parsed = parseJson(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
  if (parsed === undefined || !isObject(parsed))
    throw new Error("deployed settings are not an object");
  return parsed;
}

function hooksObject(settings: { [key: string]: Json }): { [key: string]: Json } {
  const hooks = settings["hooks"];
  if (hooks === undefined || !isObject(hooks)) throw new Error("deployed hooks are not an object");
  return hooks;
}

function permissionRules(settings: { [key: string]: Json }, key: "allow" | "deny"): Array<string> {
  const permissions = settings["permissions"];
  if (!isObject(permissions) || !Array.isArray(permissions[key])) {
    throw new Error(`deployed permissions.${key} is not an array`);
  }
  return permissions[key].filter((value): value is string => typeof value === "string");
}

function removalHome(settings: Json): string {
  const home = mkdtempSync(join(tmpdir(), "claude-removals-"));
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), stableStringify(settings));
  return home;
}

function removalContext(home: string, output: Array<string>, dryRun = false): Ctx {
  const services = makeEngineServices({
    sinks: {
      stdout: (chunk) => void output.push(chunk),
      stderr: (chunk) => void output.push(chunk),
    },
  });
  return {
    home,
    dryRun,
    claudeAdvisor: "",
    services,
    nextStepTriggers: { claudeRestart: false },
  } as Ctx;
}

function expectLegacyPointers(home: string): void {
  const settings = settingsObject(home);
  const hooks = hooksObject(settings);
  const legacyHooks = hooksObject(LEGACY_SETTINGS);
  expect(hooks["SessionStart"]).toEqual(legacyHooks["SessionStart"]);
  expect(hooks["Notification"]).toEqual(legacyHooks["Notification"]);
  expect(hooks["Stop"]).toEqual(legacyHooks["Stop"]);
  expect(settings["statusLine"]).toEqual(LEGACY_SETTINGS["statusLine"]);
}

function expectLegacyFiles(home: string): void {
  for (const [relative, marker] of Object.entries(LEGACY_FILES)) {
    expect(readFileSync(join(home, relative), "utf8")).toBe(marker);
  }
}

describe("Claude runtime migration transaction", () => {
  it("shares one deferred Bun result across an all-target legacy run", () => {
    const variant = legacyVariant();
    const run = runWithBunUnavailable(["sync"], variant);
    try {
      expect(run.exitCode, run.output).toBe(0);
      expectLegacyPointers(run.home);
      expectLegacyFiles(run.home);
      for (const relative of RUNTIME_FILES)
        expect(existsSync(join(run.home, relative))).toBe(false);
      expect(run.output.match(/curl not installed/g)).toHaveLength(1);
      expect(
        run.output.match(/Bun unavailable — Claude statusline\/hooks migration deferred/g),
      ).toHaveLength(1);
      expect(run.output).toContain(
        "Hooks:    migration deferred (Bun unavailable; existing hook/statusline settings preserved)",
      );
      expect(readArgvLog(run)).not.toMatch(/^curl\t/m);
    } finally {
      cleanup([run]);
      rmSync(variant, { recursive: true, force: true });
    }
  });

  it("installs safe hooks but no Bun-dependent commands on a fresh home without Bun", () => {
    const home = materializeVariant("home-fresh", {});
    const run = runWithBunUnavailable(["sync", "claude"], home);
    try {
      expect(run.exitCode, run.output).toBe(0);
      const settings = settingsObject(run.home);
      const hooks = hooksObject(settings);
      expect(hooks["PostToolUseFailure"]).toBeDefined();
      expect(hooks["SubagentStop"]).toBeDefined();
      for (const group of ["SessionStart", "Notification", "Stop"]) {
        expect(hooks).not.toHaveProperty(group);
      }
      expect(settings).not.toHaveProperty("statusLine");
      for (const relative of RUNTIME_FILES) {
        expect(existsSync(join(run.home, relative))).toBe(false);
      }
      expect(run.output).toContain("Bun unavailable — Claude statusline/hooks migration deferred");
    } finally {
      cleanup([run]);
    }
  });

  it("rejects invalid deployed settings before runtime or legacy fallback mutation", () => {
    const variant = legacyVariant("not-json");
    const run = runEngine(["sync", "claude"], variant, makeStubDir());
    try {
      expect(run.exitCode, run.output).toBe(1);
      expect(readFileSync(join(run.home, ".claude", "settings.json"), "utf8")).toBe("not-json");
      expectLegacyFiles(run.home);
      for (const relative of RUNTIME_FILES)
        expect(existsSync(join(run.home, relative))).toBe(false);
      expect(run.output).toContain("is not valid JSON");
    } finally {
      cleanup([run]);
      rmSync(variant, { recursive: true, force: true });
    }
  });

  it("writes runtime assets before settings commit and preserves fallbacks when that commit fails", () => {
    const original = stableStringify(LEGACY_SETTINGS);
    const variant = legacyVariant(original);
    mkdirSync(join(variant, ".claude", "settings.json.tmp"));
    const run = runEngine(["sync", "claude"], variant, makeStubDir());
    try {
      expect(run.exitCode, run.output).toBe(1);
      expect(readFileSync(join(run.home, ".claude", "settings.json"), "utf8")).toBe(original);
      expectLegacyPointers(run.home);
      expectLegacyFiles(run.home);
      for (const relative of RUNTIME_FILES) expect(existsSync(join(run.home, relative))).toBe(true);
      expect(run.output).toContain(
        "Claude runtime synced (statusline, session-start, notify, notification)",
      );
      expect(run.output).not.toContain("Pruned stale artifacts");
    } finally {
      cleanup([run]);
      rmSync(variant, { recursive: true, force: true });
    }
  });

  it("prunes a null-valued hooks.Stop key on a ready migration", () => {
    const home = removalHome({ hooks: { Stop: null, SessionStart: [{ hooks: [] }] } });
    const claudeDir = join(home, ".claude");
    const ctx = removalContext(home, []);
    try {
      syncRemovals(ctx, claudeDir, {
        kind: "ready",
        paths: claudeRuntimePaths(claudeDir, "/usr/bin/bun"),
      });
      expect(hooksObject(settingsObject(home))).toEqual({ SessionStart: [{ hooks: [] }] });
      expect(ctx.nextStepTriggers.claudeRestart).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("prunes withdrawn plugin keys but leaves user and shipped plugins enabled as configured", () => {
    const home = removalHome({
      enabledPlugins: {
        "effect-kit@docks": true,
        "session-relay@docks": false,
        "docks@docks": true,
        "personal@my-marketplace": false,
      },
    });
    try {
      syncRemovals(removalContext(home, []), join(home, ".claude"), {
        kind: "deferred",
        reason: "bun-unavailable",
      });
      expect(settingsObject(home)["enabledPlugins"]).toEqual({
        "docks@docks": true,
        "personal@my-marketplace": false,
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("removes obsolete Write permission rules without touching user or current Edit rules", () => {
    const obsolete = ["Write(**/.env)", "Write(**/.env.local)", "Write(**/secrets/**)"];
    const home = removalHome({
      permissions: {
        allow: ["Write(./)", "Edit(./)", "Write(user-owned/**)"],
        deny: [...obsolete, "Write(user-private/**)", "Edit(**/.env)"],
        ask: [],
      },
    });
    const claudeDir = join(home, ".claude");
    const original = readFileSync(join(claudeDir, "settings.json"), "utf8");
    const output: Array<string> = [];
    const deferred = { kind: "deferred", reason: "bun-unavailable" } as const;
    try {
      syncRemovals(removalContext(home, output, true), claudeDir, deferred);
      expect(readFileSync(join(claudeDir, "settings.json"), "utf8")).toBe(original);
      expect(output.join("")).toContain("[dry-run] del 4 stale permission rule(s)");

      output.length = 0;
      syncRemovals(removalContext(home, output), claudeDir, deferred);
      const settings = settingsObject(home);
      expect(permissionRules(settings, "allow")).toEqual(["Edit(./)", "Write(user-owned/**)"]);
      expect(permissionRules(settings, "deny")).toEqual([
        "Write(user-private/**)",
        "Edit(**/.env)",
      ]);
      expect(output.join("")).toContain("permission rules: 4");

      output.length = 0;
      syncRemovals(removalContext(home, output), claudeDir, deferred);
      expect(output.join("")).not.toContain("Pruned stale artifacts");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("removes home-relative retired commands even while runtime migration is deferred", () => {
    const home = removalHome({ hooks: { Stop: [{ hooks: [] }] }, userOnly: true });
    const claudeDir = join(home, ".claude");
    const retiredCommands = [".local/bin/effect-solutions", ".local/bin/session-relay"];
    for (const relative of retiredCommands) {
      mkdirSync(join(home, ".local", "bin"), { recursive: true });
      writeFileSync(join(home, relative), "retired\n");
    }
    mkdirSync(join(claudeDir, "hooks"), { recursive: true });
    writeFileSync(join(claudeDir, "hooks", "disable-claudeai-connectors.sh"), "retired\n");
    writeFileSync(join(claudeDir, "hooks", "notify.sh"), "legacy\n");
    writeFileSync(join(claudeDir, "hooks", "my-hook.sh"), "user\n");
    writeFileSync(join(claudeDir, "statusline.sh"), "legacy\n");
    const output: Array<string> = [];
    const deferred = { kind: "deferred", reason: "bun-unavailable" } as const;
    try {
      syncRemovals(removalContext(home, output, true), claudeDir, deferred);
      for (const relative of retiredCommands) expect(existsSync(join(home, relative))).toBe(true);
      expect(output.join("")).toContain(`[dry-run] rm ${join(home, retiredCommands[0])}`);

      output.length = 0;
      const ctx = removalContext(home, output);
      syncRemovals(ctx, claudeDir, deferred);
      for (const relative of retiredCommands) expect(existsSync(join(home, relative))).toBe(false);
      expect(existsSync(join(claudeDir, "hooks", "disable-claudeai-connectors.sh"))).toBe(false);
      expect(readFileSync(join(claudeDir, "hooks", "my-hook.sh"), "utf8")).toBe("user\n");
      expect(readFileSync(join(claudeDir, "hooks", "notify.sh"), "utf8")).toBe("legacy\n");
      expect(readFileSync(join(claudeDir, "statusline.sh"), "utf8")).toBe("legacy\n");
      expect(hooksObject(settingsObject(home))["Stop"]).toEqual([{ hooks: [] }]);
      expect(output.join("")).toContain("Pruned stale artifacts (hooks: 1, files: 2");
      expect(ctx.nextStepTriggers.claudeRestart).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("contextual dependency degradation", () => {
  it("syncs Claude and Codex without jq or a jq warning", () => {
    for (const target of ["claude", "codex"] as const) {
      const run = runEngine(["sync", target], "home-fresh", makeStubDir({ jq: null }, NATIVE), {
        ...NATIVE,
        maskTools: ["jq"],
      });
      try {
        expect(run.exitCode, run.output).toBe(0);
        expect(
          existsSync(
            join(run.home, target === "claude" ? ".claude/settings.json" : ".codex/config.toml"),
          ),
        ).toBe(true);
        expect(run.output).not.toContain("jq not installed");
        expect(readArgvLog(run)).not.toMatch(/^jq\t/m);
      } finally {
        cleanup([run]);
      }
    }
  });
});
