import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import type { Ctx } from "../../src/engine-native";
import { modeToolchain } from "../../src/engine-native/modes";
import { makeEngineServices } from "../../src/engine-native/services";
import { report } from "../../src/engine-native/toolchain";
import { runPublicCli } from "../lib/goldenExecution";
import { cleanupTemporaryDirs, makeStubDir, temporaryDir } from "../lib/goldenResources";
import { SPAWN_TIMEOUT_MS } from "../lib/spawnTimeout";

afterAll(cleanupTemporaryDirs);

describe("toolchain report", () => {
  it(
    "reports a present tool with an unreadable version as unknown instead of ok",
    () => {
      const stubs = makeStubDir({
        claude: `if (args[0] === "--version") process.exitCode = 9`,
      });
      const run = runPublicCli(["toolchain", "check"], "home-fresh", stubs);

      try {
        expect(run.exitCode).toBe(0);
        const claude = run.stdout.split("\n").find((line) => line.startsWith("claude"));
        expect(claude).toMatch(/^claude\s+check\s+\?\s+2\.1\.280\s+-\s+unknown$/);
      } finally {
        rmSync(run.home, { recursive: true, force: true });
      }
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe("public toolchain operands", () => {
  it.each(["check", "outdated"])(
    "rejects extra operands after %s before printing a report",
    (operation) => {
      const nativeHost = { nativeHost: true } as const;
      const stubs = makeStubDir({}, nativeHost);
      const run = runPublicCli(["toolchain", operation, "extra"], "home-fresh", stubs, nativeHost);

      try {
        expect(run.exitCode).toBe(2);
        expect(run.stdout).toBe("");
        expect(run.stderr).toContain(
          "Usage: toolchain [check|ensure <tool> [--dry-run]|outdated [--refresh]|upgrade [--dry-run]]",
        );
      } finally {
        rmSync(run.home, { recursive: true, force: true });
      }
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe("engine toolchain version report", () => {
  it.each([
    ["0.0.1", "below-floor"],
    ["999.0.0", "above-verified"],
    ["", "unknown"],
  ])("classifies installed Bun version %j as %s", async (version, status) => {
    const stdout: Array<string> = [];
    const services = makeEngineServices({ sinks: { stdout: (chunk) => void stdout.push(chunk) } });
    const ctx = {
      services: {
        ...services,
        deps: {
          ...services.deps,
          probe: (tool: string) =>
            tool === "bun"
              ? { state: "present" as const, path: "/stub/bun" }
              : { state: "missing" as const },
          version: async (tool: string) => (tool === "bun" ? version : ""),
        },
      },
    } as Ctx;

    await report(ctx);

    const bun = stdout
      .join("")
      .split("\n")
      .find((line) => line.startsWith("bun "));
    const cells = bun?.trim().split(/\s+/);
    expect(cells?.slice(0, 3)).toEqual(["bun", "managed", version || "?"]);
    expect(cells?.at(-1)).toBe(status);
  });
});

describe("public toolchain ensure", () => {
  it(
    "rejects unknown managed tools at the public boundary",
    () => {
      const stubs = makeStubDir();
      const run = runPublicCli(
        ["toolchain", "ensure", "definitely-unknown-tool"],
        "home-fresh",
        stubs,
      );

      try {
        expect(run.exitCode).toBe(2);
        expect(run.stdout).toBe("");
        expect(run.stderr).toBe("toolchain ensure needs a managed tool: bun\n");
      } finally {
        rmSync(run.home, { recursive: true, force: true });
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "previews the Bun install under --dry-run without running the installer",
    () => {
      const nativeHost = { nativeHost: true } as const;
      const stubs = makeStubDir({ bun: null }, nativeHost);
      const bunInstall = temporaryDir("toolchain-bun-install-");
      const run = runPublicCli(["toolchain", "ensure", "bun", "--dry-run"], "home-fresh", stubs, {
        ...nativeHost,
        maskTools: ["bun"],
        env: { BUN_INSTALL: bunInstall },
      });

      try {
        expect(run.exitCode).toBe(0);
        expect(run.stdout).toContain("[dry-run] install Bun 1.4.2 (kit-verified)");
        const argvLog = readFileSync(join(run.home, ".golden-argv.log"), "utf8");
        expect(argvLog.split("\n").filter((line) => line.startsWith("curl\t"))).toEqual([]);
      } finally {
        rmSync(run.home, { recursive: true, force: true });
        rmSync(bunInstall, { recursive: true, force: true });
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it.each([
    ["1.4.2", "1.4.2"],
    ["", "version unknown"],
  ])(
    "reports a present Bun with %j version without installing it",
    async (version, description) => {
      const stderr: Array<string> = [];
      const services = makeEngineServices({
        sinks: { stderr: (chunk) => void stderr.push(chunk) },
      });
      const ctx = {
        home: "/fixture-home",
        dryRun: false,
        services: {
          ...services,
          deps: {
            ...services.deps,
            probe: () => ({ state: "present" as const, path: "/stub/bun" }),
            path: async () => "/stub/bun",
            version: async () => version,
          },
        },
      } as unknown as Ctx;

      expect(await modeToolchain(ctx, ["ensure", "bun", "--verbose"])).toBe(0);
      expect(stderr.map(stripVTControlCharacters)).toEqual([`[ok] bun present (${description})\n`]);
    },
  );

  it("warns about a present Bun below the kit floor without installing it", async () => {
    const stderr: Array<string> = [];
    const services = makeEngineServices({
      sinks: { stderr: (chunk) => void stderr.push(chunk) },
    });
    const ctx = {
      home: "/fixture-home",
      dryRun: false,
      services: {
        ...services,
        deps: {
          ...services.deps,
          probe: () => ({ state: "present" as const, path: "/stub/bun" }),
          path: async () => "/stub/bun",
          version: async () => "1.4.0",
        },
      },
    } as unknown as Ctx;

    expect(await modeToolchain(ctx, ["ensure", "bun"])).toBe(0);
    expect(stderr.map(stripVTControlCharacters)).toEqual([
      "[warn] bun 1.4.0 is below the kit floor 1.4.2; run bun upgrade\n",
    ]);
  });
});

describe("engine toolchain argument errors", () => {
  it.each([
    {
      args: ["invalid-op"],
      diagnostic:
        "Usage: toolchain [check|ensure <tool> [--dry-run]|outdated [--refresh]|upgrade [--dry-run]]",
    },
    {
      args: ["check", "extra"],
      diagnostic:
        "Usage: toolchain [check|ensure <tool> [--dry-run]|outdated [--refresh]|upgrade [--dry-run]]",
    },
    {
      args: ["outdated", "extra"],
      diagnostic:
        "Usage: toolchain [check|ensure <tool> [--dry-run]|outdated [--refresh]|upgrade [--dry-run]]",
    },
    {
      args: ["ensure", "bun", "extra"],
      diagnostic:
        "Usage: toolchain [check|ensure <tool> [--dry-run]|outdated [--refresh]|upgrade [--dry-run]]",
    },
    {
      args: ["ensure", "not-managed"],
      diagnostic: "toolchain ensure supports managed tools only (bun)",
    },
  ])("exits 2 for $args without printing a report", async ({ args, diagnostic }) => {
    const stdout: Array<string> = [];
    const stderr: Array<string> = [];
    const ctx = {
      home: "/unused-invalid-toolchain-home",
      services: makeEngineServices({
        sinks: {
          stdout: (chunk) => void stdout.push(chunk),
          stderr: (chunk) => void stderr.push(chunk),
        },
      }),
    } as Ctx;

    expect(await modeToolchain(ctx, args)).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([expect.stringContaining(diagnostic)]);
  });
});
