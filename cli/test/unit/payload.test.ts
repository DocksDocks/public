import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { inventoryAuthoringPaths, payloadSourcePaths } from "../../scripts/generate-sot-payload";
import { payloadDisplayPath } from "../../src/payload";

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..");
const GENERATOR = join(REPO_DIR, "cli", "scripts", "generate-sot-payload.ts");

function copyGeneratorRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "docks-payload-"));
  cpSync(join(REPO_DIR, "SoT"), join(root, "SoT"), { recursive: true });
  cpSync(join(REPO_DIR, "docks-kit"), join(root, "docks-kit"));
  cpSync(join(REPO_DIR, "install.sh"), join(root, "install.sh"));
  cpSync(join(REPO_DIR, "docks-kit.ps1"), join(root, "docks-kit.ps1"));
  cpSync(join(REPO_DIR, "install.ps1"), join(root, "install.ps1"));
  cpSync(join(REPO_DIR, "package.json"), join(root, "package.json"));
  mkdirSync(join(root, "cli", "src"), { recursive: true });
  cpSync(join(REPO_DIR, "cli", "src", "generated"), join(root, "cli", "src", "generated"), {
    recursive: true,
  });
  return root;
}

function check(root: string) {
  return spawnSync(process.execPath, [GENERATOR, "--check", "--source-root", root], {
    encoding: "utf8",
  });
}

function generate(root: string) {
  return spawnSync(process.execPath, [GENERATOR, "--source-root", root], { encoding: "utf8" });
}

describe("generated SoT payload", () => {
  it("embeds every live SoT file in the payload", () => {
    const expected = payloadSourcePaths(REPO_DIR)
      .filter((path) => path.startsWith("SoT/"))
      .sort();
    expect(inventoryAuthoringPaths(REPO_DIR)).toEqual(expected);
  });

  it("labels generated payload sources as embedded", () => {
    expect(payloadDisplayPath("SoT/toolchain.json")).toBe("embedded:SoT/toolchain.json");
  });

  it("fails --check when an embedded SoT file changes", () => {
    const root = copyGeneratorRoot();
    try {
      const path = join(root, "SoT", ".omp", "AGENTS.md");
      writeFileSync(path, `${readFileSync(path, "utf8")}# changed\n`);
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "generated payload is stale: cli/src/generated/sotPayload.ts",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("adds a new plugin file to the payload with no list edit", () => {
    const root = copyGeneratorRoot();
    try {
      const path = join(root, "SoT", ".omp", "plugin", "skills", "probe", "SKILL.md");
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "# probe\n");
      const stale = check(root);
      expect(stale.status).toBe(1);
      expect(stale.stderr).toContain("generated payload is stale: cli/src/generated/sotPayload.ts");

      expect(generate(root).status).toBe(0);
      const module = readFileSync(join(root, "cli", "src", "generated", "sotPayload.ts"), "utf8");
      expect(module).toContain('"SoT/.omp/plugin/skills/probe/SKILL.md": "# probe\\n"');
      const paths = module.slice(module.indexOf("GENERATED_PAYLOAD_PATHS"));
      expect(paths).toContain('"SoT/.omp/plugin/skills/probe/SKILL.md"');
      expect(check(root).status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a plugin file that is not valid UTF-8", () => {
    const root = copyGeneratorRoot();
    try {
      const path = join(root, "SoT", ".omp", "plugin", "rules", "binary.md");
      writeFileSync(path, Buffer.from([0x23, 0x20, 0xff, 0x0a]));
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("SoT/.omp/plugin/rules/binary.md is not valid UTF-8");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["docks-kit", /BUN_PIN="[^"]+"/, 'BUN_PIN="0.0.0"'],
    ["docks-kit", /BUN_FLOOR="[^"]+"/, 'BUN_FLOOR="0.0.0"'],
    ["docks-kit.ps1", /\$BunPin = "[^"]+"/, '$BunPin = "0.0.0"'],
    ["docks-kit.ps1", /\$BunFloor = "[^"]+"/, '$BunFloor = "0.0.0"'],
    ["install.sh", /BUN_PIN="[^"]+"/, 'BUN_PIN="0.0.0"'],
    ["install.ps1", /\$BunPin = "[^"]+"/, '$BunPin = "0.0.0"'],
  ] as const)(
    "fails --check when a generated Bun assignment changes in %s",
    (script, assignment, replacement) => {
      const root = copyGeneratorRoot();
      try {
        const path = join(root, script);
        const original = readFileSync(path, "utf8");
        const modified = original.replace(assignment, replacement);
        if (modified === original) throw new Error(`${script} has no matching Bun assignment`);
        writeFileSync(path, modified);

        const result = check(root);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(`generated payload is stale: ${script}`);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("fails --check when package.json version changes", () => {
    const root = copyGeneratorRoot();
    try {
      const path = join(root, "package.json");
      const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      manifest["version"] = "9.8.7";
      writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "generated payload is stale: cli/src/generated/sotPayload.ts",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an invalid package.json version", () => {
    const root = copyGeneratorRoot();
    try {
      const path = join(root, "package.json");
      const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      manifest["version"] = "";
      writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("package.json has no valid version");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Spawns `cli/src/main.ts` on purpose. Every other spawning suite runs a
  // prebuilt bundle for speed, so this case is what proves the TypeScript
  // entry - the form the npm package ships - still boots and reports.
  it("reports the root package version from the public CLI", () => {
    const manifest = JSON.parse(readFileSync(join(REPO_DIR, "package.json"), "utf8")) as {
      version: string;
    };
    const result = spawnSync("bun", [join(REPO_DIR, "cli", "src", "main.ts"), "--version"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(manifest.version);
  });
});
