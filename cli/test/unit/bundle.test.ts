import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLE_PATH, bundleProblems, strayOutputs } from "../../scripts/build-bundle";

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..");
const SHEBANG = "#!/usr/bin/env bun";
const DEBUG_ID_LINE = "//# debugId=E46DDC915B7C939964756E2164756E21";

interface PackageManifest {
  readonly bin: Record<string, string>;
  readonly files: ReadonlyArray<string>;
  readonly scripts: Record<string, string>;
}

const manifest = JSON.parse(
  readFileSync(join(REPO_DIR, "package.json"), "utf8"),
) as PackageManifest;

// git cannot see an ignored file, and `bun pm pack` ships it, so the guard
// reads the file system.
describe("stray build outputs", () => {
  it("finds no .js or .js.map file under cli/src", () => {
    expect(strayOutputs(join(REPO_DIR, "cli", "src"))).toEqual([]);
  });
});

describe("bundle checks", () => {
  it("accepts a bundle with the shebang and a closing debug id", () => {
    expect(bundleProblems(`${SHEBANG}\n// @bun\nvar a=1;\n\n${DEBUG_ID_LINE}\n`)).toEqual([]);
  });

  it("rejects a bundle without the shebang", () => {
    expect(bundleProblems(`// @bun\nvar a=1;\n${DEBUG_ID_LINE}\n`)).toEqual([
      `the first line is not "${SHEBANG}"`,
    ]);
  });

  it("rejects a bundle without a closing debug id", () => {
    expect(bundleProblems(`${SHEBANG}\nvar a=1;\n`)).toEqual([
      'the last line is not "//# debugId=<hex>"',
    ]);
  });

  it("rejects a bundle that links a source map", () => {
    expect(
      bundleProblems(
        `${SHEBANG}\nvar a=1;\n//# sourceMappingURL=docks-kit.js.map\n${DEBUG_ID_LINE}\n`,
      ),
    ).toEqual(["the bundle holds a sourceMappingURL line"]);
  });
});

describe("package entry", () => {
  it("points the bin at the bundle and ships it without its map", () => {
    expect(BUNDLE_PATH).toBe("cli/dist/docks-kit.js");
    expect(manifest.bin).toEqual({ "docks-kit": BUNDLE_PATH });
    expect(manifest.files).toContain(BUNDLE_PATH);
    expect(
      manifest.files.filter((entry) => entry.endsWith(".map") || entry === "cli/dist"),
    ).toEqual([]);
  });

  it("builds a fresh bundle on every pack", () => {
    expect(manifest.scripts["build:bundle"]).toBe("bun cli/scripts/build-bundle.ts");
    expect(manifest.scripts["prepack"]).toBe("bun run check:generated && bun run build:bundle");
  });
});
