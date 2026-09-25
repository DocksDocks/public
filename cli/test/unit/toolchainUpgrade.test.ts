import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readArgvLog, runEngine, runPublicCli } from "../lib/goldenExecution";
import { cleanupTemporaryDirs, makeStubDir } from "../lib/goldenResources";
import { verifiedVersion } from "../lib/toolchainManifest";

const NATIVE_HOST = { nativeHost: true } as const;

const INTELEPHENSE = verifiedVersion("intelephense");
const TS_SERVER = verifiedVersion("typescript-language-server");
const TYPESCRIPT = verifiedVersion("tsc");

/**
 * npm stub over a global inventory kept in the run's HOME: `ls -g` reports it,
 * `prefix -g` prints `prefix` (or fails when it is undefined), and
 * `install -g pkg@ver…` exits with `installExit` and, when `applies` is true
 * and the exit is 0, records each spec in the inventory.
 */
function npmStub(
  globals: Record<string, string>,
  prefix: string | undefined,
  { installExit = 0, applies = true }: { installExit?: number; applies?: boolean } = {},
): string {
  return `const { existsSync, readFileSync, writeFileSync } = process.getBuiltinModule("node:fs")
const state = (process.env.HOME ?? process.env.USERPROFILE) + "/.stub-npm-globals.json"
const globals = existsSync(state) ? JSON.parse(readFileSync(state, "utf8")) : ${JSON.stringify(globals)}
if (args[0] === "ls") {
  console.log(JSON.stringify({ dependencies: Object.fromEntries(Object.entries(globals).map(([n, v]) => [n, { version: v }])) }))
} else if (args[0] === "prefix") {
  ${prefix === undefined ? "process.exit(1)" : `console.log(${JSON.stringify(prefix)})`}
} else if (args[0] === "install") {
  if (${installExit} === 0 && ${applies}) {
    for (const spec of args.slice(2)) {
      const at = spec.lastIndexOf("@")
      globals[spec.slice(0, at)] = spec.slice(at + 1)
    }
    writeFileSync(state, JSON.stringify(globals))
  }
  process.exit(${installExit})
}`;
}

afterAll(() => {
  cleanupTemporaryDirs();
});

describe("toolchain upgrade", () => {
  it("upgrades npm-owned servers below their verified pin in one exact npm call", () => {
    const stubs = makeStubDir(
      {
        npm: npmStub(
          { intelephense: "0.0.1", "typescript-language-server": "0.0.1", typescript: TYPESCRIPT },
          undefined,
        ),
      },
      NATIVE_HOST,
    );
    const run = runEngine(["toolchain", "upgrade"], "home-fresh", stubs, NATIVE_HOST);
    try {
      expect(run.exitCode, run.output).toBe(0);
      const installs = readArgvLog(run)
        .split("\n")
        .filter((line) => line.startsWith("npm\tinstall"));
      expect(installs).toEqual([
        `npm\tinstall -g intelephense@${INTELEPHENSE} typescript-language-server@${TS_SERVER}`,
      ]);
      expect(run.output).toContain(
        `LSP servers upgraded (intelephense 0.0.1 -> ${INTELEPHENSE}, typescript-language-server 0.0.1 -> ${TS_SERVER})`,
      );
    } finally {
      rmSync(run.home, { recursive: true, force: true });
    }
  });

  it("skips a server that npm does not own and names its path", () => {
    const stubs = makeStubDir({ npm: npmStub({ typescript: TYPESCRIPT }, undefined) }, NATIVE_HOST);
    const run = runEngine(["toolchain", "upgrade"], "home-fresh", stubs, NATIVE_HOST);
    try {
      expect(run.exitCode, run.output).toBe(0);
      expect(run.output).toMatch(
        /Skipping typescript-language-server: \S*typescript-language-server\S* is not an npm global package/,
      );
      expect(run.output).toContain("npm LSP servers: nothing to upgrade");
      expect(readArgvLog(run)).not.toContain("npm\tinstall");
    } finally {
      rmSync(run.home, { recursive: true, force: true });
    }
  });

  // npm's own bin entry is a link into <prefix>/lib/node_modules/<pkg>, and a
  // user link in another PATH directory (such as ~/.local/bin) points at that
  // entry. Only a file inside the package directory is the npm copy: a plain
  // file in <prefix>/bin, as a distro package leaves under a /usr prefix, is not.
  it.skipIf(process.platform === "win32").each([
    { layout: "npm package link", npmLayout: true },
    { layout: "plain file in the prefix bin", npmLayout: false },
  ])("decides the PATH copy by resolved package directory: $layout", ({ npmLayout }) => {
    const prefix = mkdtempSync(join(tmpdir(), "npm-prefix-"));
    const stubs = makeStubDir(
      {
        npm: npmStub(
          {
            intelephense: INTELEPHENSE,
            "typescript-language-server": "0.0.1",
            typescript: TYPESCRIPT,
          },
          prefix,
        ),
      },
      NATIVE_HOST,
    );
    const binEntry = join(prefix, "bin", "typescript-language-server");
    mkdirSync(join(prefix, "bin"));
    if (npmLayout) {
      const packageDir = join(prefix, "lib", "node_modules", "typescript-language-server", "lib");
      mkdirSync(packageDir, { recursive: true });
      renameSync(join(stubs, "typescript-language-server"), join(packageDir, "cli.mjs"));
      symlinkSync(join(packageDir, "cli.mjs"), binEntry);
    } else {
      renameSync(join(stubs, "typescript-language-server"), binEntry);
    }
    symlinkSync(binEntry, join(stubs, "typescript-language-server"));
    const run = runEngine(["toolchain", "upgrade", "--dry-run"], "home-fresh", stubs, NATIVE_HOST);
    try {
      expect(run.exitCode, run.output).toBe(0);
      expect(run.output).toContain(
        `[dry-run] would upgrade (typescript-language-server 0.0.1 -> ${TS_SERVER})`,
      );
      const warned = run.output.includes("typescript-language-server on PATH is");
      expect(warned).toBe(!npmLayout);
    } finally {
      rmSync(run.home, { recursive: true, force: true });
      rmSync(prefix, { recursive: true, force: true });
    }
  });

  it("previews through the public CLI and warns when PATH resolves another copy", () => {
    const stubs = makeStubDir(
      {
        npm: npmStub(
          {
            intelephense: INTELEPHENSE,
            "typescript-language-server": "0.0.1",
            typescript: TYPESCRIPT,
          },
          "/opt/other-npm-prefix",
        ),
      },
      NATIVE_HOST,
    );
    const run = runPublicCli(
      ["toolchain", "upgrade", "--dry-run"],
      "home-fresh",
      stubs,
      NATIVE_HOST,
    );
    try {
      expect(run.exitCode, run.stderr).toBe(0);
      const output = run.stdout + run.stderr;
      expect(output).toContain(
        `[dry-run] would upgrade (typescript-language-server 0.0.1 -> ${TS_SERVER}): npm install -g typescript-language-server@${TS_SERVER}`,
      );
      expect(output).toMatch(
        /typescript-language-server on PATH is \S+, not the npm global copy under \S*other-npm-prefix/,
      );
      const argv = readFileSync(join(run.home, ".golden-argv.log"), "utf8");
      expect(argv).not.toContain("npm\tinstall");
    } finally {
      rmSync(run.home, { recursive: true, force: true });
    }
  });

  it("exits 1 and prints the manual command when npm install fails", () => {
    const stubs = makeStubDir(
      {
        npm: npmStub({ intelephense: "0.0.1", typescript: TYPESCRIPT }, undefined, {
          installExit: 1,
        }),
      },
      NATIVE_HOST,
    );
    const run = runEngine(["toolchain", "upgrade"], "home-fresh", stubs, NATIVE_HOST);
    try {
      expect(run.exitCode).toBe(1);
      expect(run.output).toContain(
        `npm install -g intelephense@${INTELEPHENSE} failed. Try manually: npm install -g intelephense@${INTELEPHENSE}`,
      );
    } finally {
      rmSync(run.home, { recursive: true, force: true });
    }
  });

  it("reports an error when npm exits 0 but the pin did not land", () => {
    const stubs = makeStubDir(
      {
        npm: npmStub({ intelephense: "0.0.1", typescript: TYPESCRIPT }, undefined, {
          applies: false,
        }),
      },
      NATIVE_HOST,
    );
    const run = runEngine(["toolchain", "upgrade"], "home-fresh", stubs, NATIVE_HOST);
    try {
      expect(run.exitCode).toBe(1);
      expect(run.output).toContain(
        `npm install -g exited 0, but npm ls -g reports: intelephense is 0.0.1, expected ${INTELEPHENSE}`,
      );
      expect(run.output).not.toContain("LSP servers upgraded");
    } finally {
      rmSync(run.home, { recursive: true, force: true });
    }
  });

  it("never downgrades a package above its pin", () => {
    const stubs = makeStubDir(
      {
        npm: npmStub(
          {
            intelephense: "999.0.0",
            "typescript-language-server": "999.0.0",
            typescript: "999.0.0",
          },
          undefined,
        ),
      },
      NATIVE_HOST,
    );
    const run = runEngine(["toolchain", "upgrade"], "home-fresh", stubs, NATIVE_HOST);
    try {
      expect(run.exitCode, run.output).toBe(0);
      expect(run.output).toContain("npm LSP servers: nothing to upgrade");
      expect(readArgvLog(run)).not.toContain("npm\tinstall");
    } finally {
      rmSync(run.home, { recursive: true, force: true });
    }
  });

  it("skips typescript-language-server below the Node floor and still upgrades the rest", () => {
    const stubs = makeStubDir(
      {
        node: `if (args[0] === "--version") console.log("v20.0.0")`,
        npm: npmStub(
          { intelephense: "0.0.1", "typescript-language-server": "0.0.1", typescript: TYPESCRIPT },
          undefined,
        ),
      },
      NATIVE_HOST,
    );
    const run = runEngine(["toolchain", "upgrade"], "home-fresh", stubs, NATIVE_HOST);
    try {
      expect(run.exitCode, run.output).toBe(0);
      expect(run.output).toContain(
        "Skipping typescript-language-server upgrade: Node 20.0.0 is older than the",
      );
      const installs = readArgvLog(run)
        .split("\n")
        .filter((line) => line.startsWith("npm\tinstall"));
      expect(installs).toEqual([`npm\tinstall -g intelephense@${INTELEPHENSE}`]);
    } finally {
      rmSync(run.home, { recursive: true, force: true });
    }
  });
});
