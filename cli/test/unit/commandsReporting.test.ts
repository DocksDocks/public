import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { p } from "../../src/engine-native/exec";
import { cliEntry } from "../lib/cliEntry";
import { childEnv } from "../lib/goldenResources";

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..");
const CLI = cliEntry();
const temporaryDirectories = new Array<string>();

const temporaryDirectory = (prefix: string): string => {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

const runCli = (
  args: ReadonlyArray<string>,
  home: string,
  environment: Record<string, string> = {},
) =>
  spawnSync("bun", [CLI, ...args], {
    encoding: "utf8",
    env: childEnv({
      HOME: home,
      USERPROFILE: home,
      AGENTS_DIR: p(home, ".agents"),
      DOCKS_KIT_ENGINE: "",
      DOCKS_KIT_HOME: REPO_DIR,
      ...environment,
    }),
  });

const fakeCommand = (directory: string, name: string, script: string): void => {
  const source = join(directory, `${name}.mjs`);
  writeFileSync(source, script);
  if (process.platform === "win32") {
    writeFileSync(
      join(directory, `${name}.cmd`),
      `@echo off\r\n"${process.execPath}" "${source}" %*\r\n`,
    );
  } else {
    const executable = join(directory, name);
    writeFileSync(executable, `#!/bin/sh\nexec "${process.execPath}" "${source}" "$@"\n`);
    chmodSync(executable, 0o755);
  }
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("command reporting", () => {
  it("rejects explicitly empty and blank models instead of treating them as read requests", () => {
    for (const value of ["", "   "]) {
      const result = runCli(["model", "claude", value], temporaryDirectory("docks-model-empty-"));

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("Model value must not be empty or blank");
    }
  });

  it("reports malformed deployed Claude settings as JSON data with a failing exit", () => {
    const home = temporaryDirectory("docks-status-malformed-");
    mkdirSync(p(home, ".claude"), { recursive: true });
    writeFileSync(p(home, ".claude", "settings.json"), "{not-json\n");

    const result = runCli(["status", "--json"], home);
    const output = JSON.parse(result.stdout) as {
      deployment: { claude: { state: string; diagnostic: string } };
      drift: Array<{ setting: string; deployed: string; sot: string; drifted: boolean }>;
      diagnostics: Array<{ source: string; message: string; exitCode: number }>;
    };

    expect(result.status).toBe(1);
    expect(output.deployment.claude.state).toBe("malformed");
    expect(output.deployment.claude.diagnostic).toContain("invalid JSON");
    expect(output.drift).toContainEqual({
      setting: "claude.settings",
      deployed: "(malformed)",
      sot: "present",
      drifted: true,
    });
    expect(output.diagnostics).toContainEqual({
      source: "claude.settings",
      message: output.deployment.claude.diagnostic,
      exitCode: 1,
    });
    expect(result.stderr).not.toContain("SyntaxError");

    const humanResult = runCli(["status"], home);
    expect(humanResult.status).toBe(1);
    expect(humanResult.stdout).toContain(
      "ERROR claude.settings: deployed Claude settings contain invalid JSON",
    );
  });

  it("rejects a deployed Claude settings array without treating it as valid settings", () => {
    const home = temporaryDirectory("docks-status-array-");
    mkdirSync(p(home, ".claude"), { recursive: true });
    writeFileSync(p(home, ".claude", "settings.json"), "[]\n");

    const result = runCli(["status", "--json"], home);
    const output = JSON.parse(result.stdout) as {
      deployment: { claude: { state: string; diagnostic: string } };
      drift: Array<{ setting: string; deployed: string; sot: string; drifted: boolean }>;
      diagnostics: Array<{ source: string; message: string; exitCode: number }>;
    };

    expect(result.status).toBe(1);
    expect(output.deployment.claude).toEqual({
      state: "malformed",
      diagnostic: "deployed Claude settings must contain a JSON object",
    });
    expect(output.drift).toContainEqual({
      setting: "claude.settings",
      deployed: "(malformed)",
      sot: "present",
      drifted: true,
    });
    expect(output.diagnostics).toContainEqual({
      source: "claude.settings",
      message: "deployed Claude settings must contain a JSON object",
      exitCode: 1,
    });
  });

  it.each([
    ["--claude-plugin", "Invalid Claude plugin ''"],
    ["--claude-compact-window", "--claude-compact-window expects a token count"],
  ])("preserves empty %s values for engine validation", (flag, diagnostic) => {
    const result = runCli(
      ["sync", "claude", `${flag}=`, "--dry-run"],
      temporaryDirectory("docks-modifier-empty-"),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(diagnostic);
    expect(result.stdout).not.toContain("--- Sync complete ---");
  });

  it("reports engine capture failure in human and JSON status output with its exit status", () => {
    const home = temporaryDirectory("docks-status-capture-home-");
    const incompleteKit = temporaryDirectory("docks-status-capture-kit-");
    writeFileSync(p(incompleteKit, "package.json"), '{"name":"docks-kit","version":"0.0.0"}\n');
    const environment = { DOCKS_KIT_HOME: incompleteKit };

    const jsonResult = runCli(["status", "--json"], home, environment);
    const output = JSON.parse(jsonResult.stdout) as {
      toolchain: { state: string; diagnostic: string; exitCode: number };
      diagnostics: Array<{ source: string; message: string; exitCode: number }>;
    };
    expect(jsonResult.status).toBe(1);
    expect(output.toolchain).toEqual(expect.objectContaining({ state: "failed", exitCode: 1 }));
    expect(output.toolchain.diagnostic).toContain("engine capture failed for 'toolchain check'");
    expect(output.diagnostics).toContainEqual({
      source: "toolchain",
      message: output.toolchain.diagnostic,
      exitCode: 1,
    });

    const humanResult = runCli(["status"], home, environment);
    expect(humanResult.status).toBe(1);
    expect(humanResult.stdout).toContain("ERROR: engine capture failed for 'toolchain check'");
  });

  // Engine-native goldens bypass the public parser. This checks that multiple
  // positional targets reach the selected pipelines and invalid later targets fail.
  it("carries every positional sync target through the public CLI parser", () => {
    const home = temporaryDirectory("docks-sync-variadic-");

    const selected = runCli(["sync", "claude", "codex", "--dry-run"], home);
    expect(selected.status).toBe(0);
    expect(selected.stdout).toContain("Claude:");
    expect(selected.stdout).toContain("Codex:");
    expect(selected.stdout).not.toContain("Skills:");

    const invalid = runCli(["sync", "claude", "bogus", "--dry-run"], home);
    expect(invalid.status).toBe(2);
    expect(invalid.stderr).toContain("Unknown sync target(s): bogus");
    expect(invalid.stdout).not.toContain("--- Sync complete ---");
  });
});

describe("update install detection", () => {
  it("prefers a dirty checkout over a global package path and selects npm for an installed package", () => {
    const home = temporaryDirectory("docks-update-detection-");
    const bin = temporaryDirectory("docks-update-bin-");
    const checkout = join(home, "node_modules", "checkout");
    const installed = join(home, "node_modules", "docks-kit");
    mkdirSync(p(checkout, ".git"), { recursive: true });
    mkdirSync(installed, { recursive: true });
    for (const directory of [checkout, installed]) {
      writeFileSync(p(directory, "package.json"), '{"name":"docks-kit","version":"0.1.0"}\n');
    }
    fakeCommand(
      bin,
      "git",
      `const args = process.argv.slice(2);
if (args[0] === "--version") process.exit(0);
if (args.at(-1) === "--porcelain") {
  process.stdout.write(" M package.json\\n");
  process.exit(0);
}
process.exit(17);
`,
    );
    fakeCommand(
      bin,
      "npm",
      `process.stdout.write("npm stub: " + process.argv.slice(2).join(" ") + "\\n");
process.exit(9);
`,
    );
    const environment = {
      PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}`,
      BUN_INSTALL: "",
      BUN_INSTALL_GLOBAL_DIR: "",
    };

    const dirty = runCli(["update", "--no-sync"], home, {
      ...environment,
      DOCKS_KIT_HOME: checkout,
    });
    expect(dirty.status).toBe(2);
    expect(dirty.stderr).toContain(`kit checkout ${checkout} has local changes`);
    expect(dirty.stdout).not.toContain("npm stub:");

    const packageUpdate = runCli(["update", "--no-sync"], home, {
      ...environment,
      DOCKS_KIT_HOME: installed,
    });
    expect(packageUpdate.status).toBe(1);
    expect(packageUpdate.stdout).toContain("npm stub: install -g docks-kit@latest");
    expect(packageUpdate.stderr).toContain(
      "global package update failed (npm install -g docks-kit@latest)",
    );
  });

  it("rejects a kit home that is neither a checkout nor a global package", () => {
    const home = temporaryDirectory("docks-update-unrecognized-");
    writeFileSync(p(home, "package.json"), '{"name":"docks-kit","version":"0.1.0"}\n');

    const result = runCli(["update", "--no-sync"], home, { DOCKS_KIT_HOME: home });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      `kit home ${home} is neither a git checkout nor a global package install`,
    );
  });
});
