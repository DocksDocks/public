import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..");
const ARTIFACT_PATTERN = /\bdocks-kit-(?:linux|darwin|windows)-[a-z0-9-]+(?:\.exe)?\b/g;
const PIN_BLOCK_PATTERN = /# BEGIN GENERATED BUN PIN\r?\n([\s\S]*?)\r?\n# END GENERATED BUN PIN/g;

function repoFile(path: string): string {
  return readFileSync(resolve(REPO_DIR, path), "utf8");
}

function sorted(values: Iterable<string>): Array<string> {
  return [...values].sort();
}

function mentionedArtifacts(source: string): Array<string> {
  return sorted(new Set(source.match(ARTIFACT_PATTERN) ?? []));
}

function generatedPinBody(source: string): string {
  const blocks = [...source.matchAll(PIN_BLOCK_PATTERN)];
  expect(blocks, "generated Bun pin block count").toHaveLength(1);
  return blocks[0]?.[1]?.trim() ?? "";
}

describe("host target script contracts", () => {
  it("names exactly the four supported POSIX binary artifacts in the Bash launcher", () => {
    expect(mentionedArtifacts(repoFile("docks-kit"))).toEqual([
      "docks-kit-darwin-arm64",
      "docks-kit-darwin-x64",
      "docks-kit-linux-arm64",
      "docks-kit-linux-x64",
    ]);
  });

  it("names exactly the two supported Windows binary artifacts in the PowerShell launcher", () => {
    expect(mentionedArtifacts(repoFile("docks-kit.ps1"))).toEqual([
      "docks-kit-windows-arm64.exe",
      "docks-kit-windows-x64.exe",
    ]);
  });

  it("keeps the generated Bun pin synchronized across every launcher and installer", () => {
    const manifest = JSON.parse(repoFile("SoT/toolchain.json")) as {
      tools: { bun: { verified: string } };
    };
    const version = manifest.tools.bun.verified;
    const scripts = [
      ["docks-kit", `BUN_PIN="${version}"`],
      ["docks-kit.ps1", `$BunPin = "${version}"`],
      ["install.sh", `BUN_PIN="${version}"`],
      ["install.ps1", `$BunPin = "${version}"`],
    ] as const;

    for (const [path, assignment] of scripts) {
      expect(generatedPinBody(repoFile(path)), path).toBe(assignment);
    }
  });
});
