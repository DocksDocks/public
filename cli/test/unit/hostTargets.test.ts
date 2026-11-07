import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { HOST_TARGETS } from "../../src/engine-native/os/targets";

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..");
const ARTIFACT_PATTERN = /\bdocks-kit-(?:linux|darwin|windows)-[a-z0-9-]+(?:\.exe)?\b/g;
const PIN_BLOCK_PATTERN = /# BEGIN GENERATED BUN PIN\r?\n([\s\S]*?)\r?\n# END GENERATED BUN PIN/g;
const RELEASE_WORKFLOW = ".github/workflows/release-cli.yml";

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

function defaultBuildTargets(source: string): Array<string> {
  const assignment = source.match(/\|\|\s*TARGETS=\(([^)]*)\)/)?.[1];
  expect(assignment, "default TARGETS assignment").toBeDefined();
  return assignment?.trim().split(/\s+/) ?? [];
}

/** The artifact names in each release list of release-cli.yml. */
interface ReleaseLists {
  /** Job `build`, the `actions/upload-artifact` step, `with.path`. */
  readonly upload: Array<string>;
  /** Job `github-release`, the `for asset in ...; do` words of the `gh release upload` step. */
  readonly release: Array<string>;
}

interface WorkflowStep {
  readonly uses?: string;
  readonly run?: string;
  readonly with?: { readonly path?: string };
}

interface Workflow {
  readonly jobs: Record<string, { readonly steps: ReadonlyArray<WorkflowStep> }>;
}

/** Read each release list alone, so that a name in one list cannot hide a gap in the other. */
function releaseListArtifacts(source: string): ReleaseLists {
  const { jobs } = parse(source) as Workflow;
  const uploads = jobs.build?.steps.filter(({ uses }) =>
    uses?.startsWith("actions/upload-artifact@"),
  );
  expect(uploads, "upload-artifact steps in job build").toHaveLength(1);
  const releases = jobs["github-release"]?.steps.filter(({ run }) =>
    run?.includes("gh release upload"),
  );
  expect(releases, "gh release upload steps in job github-release").toHaveLength(1);
  const assets = releases?.[0]?.run?.match(/\bfor asset in ([^;]*); do\b/)?.[1];
  expect(assets, "for asset in ...; do word list").toBeDefined();
  return {
    upload: mentionedArtifacts(uploads?.[0]?.with?.path ?? ""),
    release: mentionedArtifacts(assets ?? ""),
  };
}

describe("host target script contracts", () => {
  it("keeps the Bash launcher aligned with every POSIX host target", () => {
    const launcher = repoFile("docks-kit");
    const targets = HOST_TARGETS.filter(({ platform }) => platform !== "windows");

    expect(mentionedArtifacts(launcher)).toEqual(sorted(targets.map(({ artifact }) => artifact)));
    for (const key of targets.flatMap(({ unameKeys }) => unameKeys)) {
      expect(launcher, key).toContain(key);
    }
  });

  it("keeps the PowerShell launcher aligned with every Windows host target", () => {
    const launcher = repoFile("docks-kit.ps1");
    const targets = HOST_TARGETS.filter(({ platform }) => platform === "windows");

    expect(mentionedArtifacts(launcher)).toEqual(sorted(targets.map(({ artifact }) => artifact)));
    for (const architecture of targets.flatMap(
      ({ processorArchitectures }) => processorArchitectures,
    )) {
      expect(launcher, architecture).toContain(architecture);
    }
  });

  it("builds exactly the four supported host targets by default", () => {
    expect(HOST_TARGETS.map(({ id }) => id)).toEqual([
      "linux-x64",
      "linux-arm64",
      "darwin-arm64",
      "windows-x64",
    ]);
    expect(defaultBuildTargets(repoFile("cli/build-binaries.sh"))).toEqual(
      HOST_TARGETS.map(({ id }) => id),
    );
  });

  it("names every HOST_TARGETS artifact in release-cli.yml", () => {
    const names = sorted(HOST_TARGETS.map(({ artifact }) => artifact));

    expect(releaseListArtifacts(repoFile(RELEASE_WORKFLOW))).toEqual({
      upload: names,
      release: names,
    });
  });

  it("finds an artifact missing from only one release-cli.yml list", () => {
    const source = repoFile(RELEASE_WORKFLOW);
    const names = sorted(HOST_TARGETS.map(({ artifact }) => artifact));
    const dropped = "docks-kit-darwin-arm64";
    const others = names.filter((name) => name !== dropped);
    const withoutUpload = source.replace(new RegExp(`^[ \\t]*cli/dist/${dropped}\\r?\\n`, "m"), "");
    const withoutRelease = source.replace(new RegExp(`(for asset in [^;]*?) ${dropped}\\b`), "$1");

    expect(withoutUpload, "upload list copy").not.toBe(source);
    expect(releaseListArtifacts(withoutUpload)).toEqual({ upload: others, release: names });
    expect(withoutRelease, "release list copy").not.toBe(source);
    expect(releaseListArtifacts(withoutRelease)).toEqual({ upload: names, release: others });
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

  // Windows PowerShell 5.1 reads a script without a BOM in the ANSI code page,
  // where a UTF-8 em dash decodes to a closing quote and breaks the parse.
  it.each(["docks-kit.ps1", "install.ps1"])("keeps %s pure ASCII", (path) => {
    const bytes = readFileSync(resolve(REPO_DIR, path));
    expect([...bytes].some((byte) => byte > 0x7f)).toBe(false);
  });
});
