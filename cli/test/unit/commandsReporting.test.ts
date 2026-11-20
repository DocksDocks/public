import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { p } from "../../src/engine-native/exec";
import { GENERATED_PACKAGE_VERSION } from "../../src/generated/sotPayload";
import { BUN_RUNTIME, cliEntry } from "../lib/cliEntry";
import { childEnv, cleanupTemporaryDirs, makeStubDir } from "../lib/goldenResources";
import { SPAWN_TIMEOUT_MS } from "../lib/spawnTimeout";

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..");
const CLI = cliEntry();
const temporaryDirectories = new Array<string>();

// `sync --dry-run` version-probes harness CLIs such as omp. The golden stubs
// come first on PATH, so those probes never run the host's binaries.
let toolStubs = "";

const temporaryDirectory = (prefix: string): string => {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

// The CLI runs on the absolute Bun runtime: a PATH lookup of `bun` would find
// the stub `bun`, which prints a version and exits.
const runCli = (
  args: ReadonlyArray<string>,
  home: string,
  environment: Record<string, string> = {},
) =>
  spawnSync(BUN_RUNTIME, [CLI, ...args], {
    encoding: "utf8",
    env: childEnv({
      HOME: home,
      USERPROFILE: home,
      DOCKS_KIT_ENGINE: "",
      DOCKS_KIT_HOME: REPO_DIR,
      PATH: `${toolStubs}${delimiter}${process.env["PATH"] ?? ""}`,
      ...environment,
    }),
    timeout: SPAWN_TIMEOUT_MS,
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

beforeAll(() => {
  toolStubs = makeStubDir({}, { nativeHost: true });
});

afterAll(cleanupTemporaryDirs);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("command reporting", () => {
  // Engine-native goldens bypass the public parser. This checks that the
  // flag-less public sync plans the omp pipeline and nothing under ~/.agents.
  it(
    "runs the omp pipeline for a flag-less sync through the public CLI parser",
    () => {
      const home = temporaryDirectory("docks-sync-omp-only-");

      const result = runCli(["sync", "--dry-run"], home);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("--- Sync complete ---");
      expect(result.stdout).toContain("omp:");
      expect(result.stdout).not.toContain("Skills:");
      expect(`${result.stdout}${result.stderr}`).not.toMatch(/\.agents[\\/]|\.claude[\\/]/);
    },
    SPAWN_TIMEOUT_MS,
  );

  // Effect 4.0.7 and later reject any flag given twice, so a repeated presence-only
  // action must reach Effect once.
  it(
    "answers a repeated global action once through the public CLI parser",
    () => {
      const home = temporaryDirectory("docks-repeated-action-");

      const version = runCli(["--version", "-v"], home);
      expect(version.status, version.stderr).toBe(0);
      // The launchers compare this output with the bare package version.
      expect(version.stdout).toBe(`${GENERATED_PACKAGE_VERSION}\n`);
      expect(version.stdout).toBe(runCli(["--version"], home).stdout);

      const help = runCli(["--help", "-h"], home);
      expect(help.status, help.stderr).toBe(0);
      expect(help.stdout).toBe(runCli(["--help"], home).stdout);
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe("update install detection", () => {
  it(
    "prefers a dirty checkout over a global package path and selects npm for an installed package",
    () => {
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
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "rejects a kit home that is neither a checkout nor a global package",
    () => {
      const home = temporaryDirectory("docks-update-unrecognized-");
      writeFileSync(p(home, "package.json"), '{"name":"docks-kit","version":"0.1.0"}\n');

      const result = runCli(["update", "--no-sync"], home, { DOCKS_KIT_HOME: home });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(
        `kit home ${home} is neither a git checkout nor a global package install`,
      );
    },
    SPAWN_TIMEOUT_MS,
  );
});
