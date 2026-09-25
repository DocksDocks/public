import { describe, expect, it, vi } from "vitest";
import {
  packageManagerForHome,
  packageUpdateResult,
  resolveGlobalPackageHome,
} from "../../src/commands/update";
import { spawnHost } from "../../src/engine-native/exec";
import { hostOs } from "../../src/engine-native/os";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const spawnCalls: Array<{
  command: string;
  args: Array<string>;
  options: Record<string, unknown>;
}> = [];

vi.mock("node:child_process", () => ({
  spawnSync: (command: string, args: Array<string>, options: Record<string, unknown>) => {
    spawnCalls.push({ command, args, options });
    return { status: 0, signal: null, stdout: "", stderr: "", output: [], pid: 1 };
  },
}));

describe("package update target", () => {
  it("resolves the npm global package root that the selected manager writes", () => {
    const capture = (command: string, args: ReadonlyArray<string>) => {
      expect(command).toBe("npm");
      expect(args).toEqual(["root", "-g"]);
      return { status: 0, stdout: "C:\\new-prefix\\lib\\node_modules\n" };
    };

    expect(resolveGlobalPackageHome("npm", capture)).toEqual({
      ok: true,
      home: "C:\\new-prefix\\lib\\node_modules/docks-kit",
    });
  });

  it("resolves the Bun global package root that the selected manager reports", () => {
    const capture = (command: string, args: ReadonlyArray<string>) => {
      expect(command).toBe("bun");
      expect(args).toEqual(["pm", "-g", "ls"]);
      return {
        status: 0,
        stdout: "C:\\new-bun\\install\\global node_modules (1)\n└── docks-kit@0.15.1\n",
      };
    };

    expect(resolveGlobalPackageHome("bun", capture)).toEqual({
      ok: true,
      home: "C:\\new-bun\\install\\global/node_modules/docks-kit",
    });
  });

  it("resolves the Bun 1.4.2 global package root with an installed-count annotation", () => {
    const capture = () => ({
      status: 0,
      stdout:
        "/home/u/.bun/install/global node_modules (64 installed)\n├── bun@1.3.14\n└── docks-kit@0.16.3\n",
    });

    expect(resolveGlobalPackageHome("bun", capture)).toEqual({
      ok: true,
      home: "/home/u/.bun/install/global/node_modules/docks-kit",
    });
  });

  it("resolves the Bun global package root without an annotation", () => {
    const capture = () => ({
      status: 0,
      stdout: "/home/u/.bun/install/global node_modules\n└── docks-kit@0.16.3\n",
    });

    expect(resolveGlobalPackageHome("bun", capture)).toEqual({
      ok: true,
      home: "/home/u/.bun/install/global/node_modules/docks-kit",
    });
  });

  it("rejects Bun output without a global package root header", () => {
    const capture = () => ({
      status: 0,
      stdout:
        "/home/u/.bun/install/global node_modules unexpected text\n├── bun@1.3.14\n└── docks-kit@0.16.3\n",
    });

    expect(resolveGlobalPackageHome("bun", capture)).toEqual({
      ok: false,
      diagnostic: "bun pm -g ls did not report its global package root",
    });
  });

  it.each([
    ["npm", ["root", "-g"]],
    ["bun", ["pm", "-g", "ls"]],
  ] as const)("reports %s global-root probe failures", (manager, args) => {
    expect(
      resolveGlobalPackageHome(manager, (command, actualArgs) => {
        expect(command).toBe(manager);
        expect(actualArgs).toEqual(args);
        return { status: 7, stdout: "" };
      }),
    ).toEqual({
      ok: false,
      diagnostic: `${manager} ${args.join(" ")} failed: exit 7`,
    });
  });

  it("rejects an empty npm global root instead of treating it as an install directory", () => {
    expect(resolveGlobalPackageHome("npm", () => ({ status: 0, stdout: " \n" }))).toEqual({
      ok: false,
      diagnostic: "npm root -g failed: empty output",
    });
  });

  it("reports a global-root probe that could not start", () => {
    expect(
      resolveGlobalPackageHome("bun", () => ({
        status: null,
        stdout: "",
        error: new Error("command not found on PATH: bun"),
      })),
    ).toEqual({
      ok: false,
      diagnostic: "bun pm -g ls failed: command not found on PATH: bun",
    });
  });

  const linux = hostOs("linux");
  const windows = hostOs("windows");

  it.each([
    {
      name: "POSIX backslashes are filename characters",
      home: "/tmp/package\\.bun\\node_modules/docks-kit",
      environment: {},
      host: linux,
      manager: "npm",
    },
    {
      name: "POSIX .bun segment",
      home: "/home/u/.bun/install/global/node_modules/docks-kit",
      environment: {},
      host: linux,
      manager: "bun",
    },
    {
      name: "Windows .bun segment with backslashes",
      home: "C:\\Users\\u\\.bun\\install\\global\\node_modules\\docks-kit",
      environment: {},
      host: windows,
      manager: "bun",
    },
    {
      name: "Windows .bun segment with mixed separators",
      home: "C:\\Users\\u\\.bun\\install\\global/node_modules/docks-kit",
      environment: {},
      host: windows,
      manager: "bun",
    },
    {
      name: "Windows Bun install root",
      home: "D:\\tools\\bun\\install\\global/node_modules/docks-kit",
      environment: { BUN_INSTALL: "D:\\tools\\bun" },
      host: windows,
      manager: "bun",
    },
    {
      name: "custom global root",
      home: "/opt/custom/node_modules/docks-kit",
      environment: { BUN_INSTALL_GLOBAL_DIR: "/opt/custom" },
      host: linux,
      manager: "bun",
    },
    {
      name: "custom global root with a trailing slash",
      home: "/opt/custom/node_modules/docks-kit",
      environment: { BUN_INSTALL_GLOBAL_DIR: "/opt/custom/" },
      host: linux,
      manager: "bun",
    },
    {
      name: "Windows custom global root with different casing",
      home: "c:\\tools\\bun\\global\\node_modules\\docks-kit",
      environment: { BUN_INSTALL_GLOBAL_DIR: "C:\\Tools\\Bun\\global" },
      host: windows,
      manager: "bun",
    },
    {
      name: "custom root itself",
      home: "/opt/custom",
      environment: { BUN_INSTALL_GLOBAL_DIR: "/opt/custom/" },
      host: linux,
      manager: "bun",
    },
    {
      name: "sibling prefix is not contained",
      home: "/opt/custom2/node_modules/docks-kit",
      environment: { BUN_INSTALL_GLOBAL_DIR: "/opt/custom" },
      host: linux,
      manager: "npm",
    },
    {
      name: "POSIX root casing remains significant",
      home: "/opt/Custom/node_modules/docks-kit",
      environment: { BUN_INSTALL_GLOBAL_DIR: "/opt/custom" },
      host: linux,
      manager: "npm",
    },
    {
      name: "Windows npm global home",
      home: "C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules/docks-kit",
      environment: {},
      host: windows,
      manager: "npm",
    },
  ] as const)("classifies $name as $manager", ({ home, environment, host, manager }) => {
    expect(packageManagerForHome(home, environment, host)).toBe(manager);
  });
});

describe("package update result", () => {
  it.each([
    [
      "the same root and the same version",
      "0.14.3",
      "0.14.3",
      true,
      { alreadyCurrent: true, message: "Already at the latest version (0.14.3)." },
    ],
    [
      "the same root and different versions",
      "0.14.2",
      "0.14.3",
      true,
      { alreadyCurrent: false, message: "Updated 0.14.2 -> 0.14.3." },
    ],
    [
      "different roots and the same version",
      "0.14.3",
      "0.14.3",
      false,
      {
        alreadyCurrent: false,
        message: "Installed 0.14.3 in the selected global package root.",
      },
    ],
    [
      "different roots and different versions",
      "0.14.2",
      "0.14.3",
      false,
      {
        alreadyCurrent: false,
        message: "Installed 0.14.3 in the selected global package root.",
      },
    ],
    ["a missing before version", "", "0.14.3", false, { alreadyCurrent: false, message: "" }],
    ["a missing after version", "0.14.2", "", false, { alreadyCurrent: false, message: "" }],
  ] as const)("reports %s", (_case, before, after, samePackageRoot, expected) => {
    expect(packageUpdateResult(before, after, samePackageRoot)).toEqual(expected);
  });
});

/** A PATH holding exactly the named shims, so resolution is the same on every host. */
const withPath = <A>(names: ReadonlyArray<string>, use: () => A): A => {
  const dir = mkdtempSync(join(tmpdir(), "docks-update-spawn-"));
  const savedPath = process.env["PATH"];
  try {
    for (const name of names) {
      const shim = join(dir, name);
      writeFileSync(shim, "");
      chmodSync(shim, 0o755);
    }
    process.env["PATH"] = dir;
    return use();
  } finally {
    // Assigning `undefined` would write the string "undefined" into the environment.
    if (savedPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = savedPath;
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("host child spawning (exec.spawnHost)", () => {
  it("keeps Windows shim arguments verbatim when invoking the command interpreter", () => {
    spawnCalls.length = 0;

    withPath(["npx.cmd"], () => spawnHost("npx", ["a&b"], {}, hostOs("windows")));

    const call = spawnCalls.at(-1);
    expect(call?.args.slice(0, 4)).toEqual(["/d", "/v:off", "/s", "/c"]);
    expect(call?.command).toMatch(/(?:^|[\\/])cmd\.exe$/i);
    expect(call?.args.at(-1)).toContain("a^&b");
    // Re-quoting by libuv would invalidate the command line's cmd.exe escaping.
    expect(call?.options["windowsVerbatimArguments"]).toBe(true);
  });

  it("reports an unresolvable Windows tool instead of spawning a pathless name", () => {
    spawnCalls.length = 0;

    // An empty PATH, so a runner that happens to hold this name cannot answer.
    const res = withPath([], () =>
      spawnHost("docks-kit-absent-tool", ["--version"], {}, hostOs("windows")),
    );

    expect(spawnCalls).toEqual([]);
    expect(res.status).toBeNull();
    expect(res.error?.message).toBe("command not found on PATH: docks-kit-absent-tool");
  });
});
