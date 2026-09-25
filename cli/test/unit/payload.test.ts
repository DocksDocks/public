import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTHORING_EXCLUSIONS,
  PAYLOAD_PATHS,
  inventoryAuthoringPaths,
} from "../../scripts/generate-sot-payload";
import { payloadDisplayPath } from "../../src/payload";

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..");
const GENERATOR = join(REPO_DIR, "cli", "scripts", "generate-sot-payload.ts");

function copyGeneratorRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "docks-payload-"));
  cpSync(join(REPO_DIR, "SoT"), join(root, "SoT"), { recursive: true });
  cpSync(join(REPO_DIR, "notification.mp3"), join(root, "notification.mp3"));
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

describe("generated SoT payload", () => {
  it("makes every live SoT file an allowlist or explicit exclusion", () => {
    const expected = [
      ...PAYLOAD_PATHS.filter((path) => path.startsWith("SoT/")),
      ...AUTHORING_EXCLUSIONS.filter((path) => existsSync(join(REPO_DIR, ...path.split("/")))),
    ].sort();
    expect(inventoryAuthoringPaths(REPO_DIR)).toEqual(expected);
  });

  it("labels generated payload sources as embedded", () => {
    expect(payloadDisplayPath("SoT/models.json")).toBe("embedded:SoT/models.json");
  });

  it("fails --check when notification.mp3 changes", () => {
    const root = copyGeneratorRoot();
    try {
      const path = join(root, "notification.mp3");
      writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from([0])]));
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "generated payload is stale: cli/src/generated/sotPayload.ts",
      );
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
