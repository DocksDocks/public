import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import config from "../../../scripts/pluginContent/config.json" with { type: "json" };
import { checkExtensions } from "../../../scripts/pluginContent/extensions.ts";

/**
 * The docks extension load check (`gateExtensions` of `scripts/ci.mjs`), ported
 * to the kit plugin: each `omp.extensions` entry is a file inside the plugin
 * folder that imports without error and has a default function export.
 */
const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");

const fixtures: Array<string> = [];

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

const GOOD = "export default function extension(): void {}\n";

/** A temporary repository root with a plugin that has `files` and `extensions`. */
function pluginFixture(files: Readonly<Record<string, string>>, extensions: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "kit-plugin-extensions-"));
  fixtures.push(root);
  const plugin = join(root, config.pluginDir);
  mkdirSync(plugin, { recursive: true });
  writeFileSync(
    join(plugin, "package.json"),
    JSON.stringify({ name: "fixture", type: "module", omp: { extensions } }),
  );
  for (const [relative, text] of Object.entries(files)) {
    const file = join(plugin, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

function expectFailure(failures: ReadonlyArray<string>, entry: string, detail: string): void {
  expect(
    failures.some((failure) => failure.includes(`entry ${entry} `) && failure.includes(detail)),
    `no failure names ${entry} with "${detail}"; failures: ${JSON.stringify(failures)}`,
  ).toBe(true);
}

describe("kit plugin extensions", () => {
  it("imports each live manifest extension with a default function export", async () => {
    expect(await checkExtensions(REPO_ROOT)).toEqual([]);
  });

  it("passes a file entry and a folder entry with a default function export", async () => {
    const root = pluginFixture({ "extensions/one.ts": GOOD, "extensions/two/index.ts": GOOD }, [
      "./extensions/one.ts",
      "./extensions/two",
    ]);
    expect(await checkExtensions(root)).toEqual([]);
  });

  it("fails an entry without a default export", async () => {
    const root = pluginFixture({ "extensions/none.ts": "export const value = 1;\n" }, [
      "./extensions/none.ts",
    ]);
    expectFailure(
      await checkExtensions(root),
      "./extensions/none.ts",
      "has no default function export",
    );
  });

  it("fails an entry outside the plugin folder", async () => {
    const root = pluginFixture({}, ["../outside.ts"]);
    writeFileSync(join(root, "SoT", ".omp", "outside.ts"), GOOD);
    expectFailure(await checkExtensions(root), "../outside.ts", "is outside the plugin folder");
  });

  it("fails an entry that a symbolic link puts outside the plugin folder", async () => {
    const root = pluginFixture({}, ["./extensions/link.ts"]);
    const outside = join(root, "outside.ts");
    writeFileSync(outside, GOOD);
    mkdirSync(join(root, config.pluginDir, "extensions"));
    symlinkSync(outside, join(root, config.pluginDir, "extensions", "link.ts"));
    expectFailure(
      await checkExtensions(root),
      "./extensions/link.ts",
      "is outside the plugin folder after symbolic links resolve",
    );
  });

  it("fails a missing entry and a module that throws at import", async () => {
    const root = pluginFixture(
      {
        "extensions/throws.ts": 'throw new Error("boom");\nexport default function x(): void {}\n',
      },
      ["./extensions/missing.ts", "./extensions/throws.ts"],
    );
    const failures = await checkExtensions(root);
    expectFailure(failures, "./extensions/missing.ts", "is not a file");
    expectFailure(failures, "./extensions/throws.ts", "throws at import: boom");
  });

  it("fails an extensions value that is not a list of strings", async () => {
    const root = pluginFixture({}, "./extensions/one.ts");
    expect(await checkExtensions(root)).toEqual([
      `${config.pluginDir}/package.json: omp.extensions must be an array of strings`,
    ]);
  });
});
