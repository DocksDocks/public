import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hostOs } from "../../src/engine-native/os/index";
import { HOST_TARGETS } from "../../src/engine-native/os/targets";

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..");
const roots: Array<string> = [];
const currentHost = hostOs().id;
const BUILD_SCRIPT_APPLIES = currentHost === "linux" || currentHost === "darwin";
const buildSuiteLabel = BUILD_SCRIPT_APPLIES
  ? "compiled binary checksum manifest"
  : "compiled binary checksum manifest (skipped: cli/build-binaries.sh is a POSIX artifact and does not apply to this host)";

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(version = "9.9.9"): { buildScript: string; dist: string; fakeBin: string } {
  const root = mkdtempSync(join(tmpdir(), "docks-build-"));
  roots.push(root);
  const cliDir = join(root, "cli");
  const dist = join(cliDir, "dist");
  const fakeBin = join(root, "test-bin");
  mkdirSync(dist, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "docks-kit", version }, null, 2)}\n`,
  );

  const buildScript = join(cliDir, "build-binaries.sh");
  writeFileSync(buildScript, readFileSync(join(REPO_DIR, "cli", "build-binaries.sh")));
  chmodSync(buildScript, 0o755);

  const bun = join(fakeBin, "bun");
  writeFileSync(
    bun,
    `#!/bin/bash
if [[ "\${1:-}" != "build" ]]; then
  exit 0
fi
out=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--outfile" ]]; then
    shift
    out="$1"
    break
  fi
  shift
done
[[ -n "$out" ]] || exit 2
printf '%s\\n' 'new binary' > "$out"
chmod +x "$out"
`,
  );
  chmodSync(bun, 0o755);

  return { buildScript, dist, fakeBin };
}

function runBuild(buildScript: string, fakeBin: string, targets: ReadonlyArray<string> = []) {
  return spawnSync("/bin/bash", [buildScript, ...targets], {
    encoding: "utf8",
    env: { ...process.env, PATH: [fakeBin, "/usr/bin", "/bin"].join(delimiter) },
  });
}

function manifestArtifacts(dist: string): Array<string> {
  return readFileSync(join(dist, "SHA256SUMS"), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.replace(/^[a-f0-9]+\s+/, ""));
}

describe.skipIf(!BUILD_SCRIPT_APPLIES)(buildSuiteLabel, () => {
  it("builds every host target by default with deterministic artifact names", () => {
    const { buildScript, dist, fakeBin } = fixture();

    const result = runBuild(buildScript, fakeBin);
    const expected = HOST_TARGETS.map(({ artifact }) => artifact).sort();

    expect(result.status, result.stderr).toBe(0);
    expect(manifestArtifacts(dist)).toEqual(expected);
    for (const artifact of expected) {
      expect(existsSync(join(dist, artifact)), artifact).toBe(true);
    }
  });

  it("keeps retained target checksums after a subset build", () => {
    const { buildScript, dist, fakeBin } = fixture();
    const retained = join(dist, "docks-kit-darwin-arm64");
    writeFileSync(retained, "retained binary\n");
    chmodSync(retained, 0o755);

    const result = runBuild(buildScript, fakeBin, ["linux-x64"]);

    expect(result.status, result.stderr).toBe(0);
    expect(manifestArtifacts(dist)).toEqual(["docks-kit-darwin-arm64", "docks-kit-linux-x64"]);
  });

  it("stamps the dist version after a full build", () => {
    const { buildScript, dist, fakeBin } = fixture("1.2.3");

    const result = runBuild(buildScript, fakeBin);

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(dist, "VERSION"), "utf8").trim()).toBe("1.2.3");
    expect(result.stderr).not.toContain("retained without rebuild");
  });

  it("never checksums a packed tarball beside the binaries", () => {
    const { buildScript, dist, fakeBin } = fixture();
    writeFileSync(join(dist, "docks-kit-0.15.5.tgz"), "tarball\n");

    const result = runBuild(buildScript, fakeBin, ["linux-x64"]);

    expect(result.status, result.stderr).toBe(0);
    expect(manifestArtifacts(dist)).toEqual(["docks-kit-linux-x64"]);
  });

  // Stamping a mixed dist would certify it as one version, so the warning
  // would fire once and never again.
  it("refuses to stamp a dist that mixes versions, and keeps warning", () => {
    const { buildScript, dist, fakeBin } = fixture("1.2.3");
    const retained = join(dist, "docks-kit-darwin-arm64");
    writeFileSync(retained, "older binary\n");
    chmodSync(retained, 0o755);
    writeFileSync(join(dist, "VERSION"), "0.0.1\n");

    const first = runBuild(buildScript, fakeBin, ["linux-x64"]);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stderr).toContain("retained without rebuild: docks-kit-darwin-arm64");
    expect(readFileSync(join(dist, "VERSION"), "utf8").trim()).toBe("0.0.1");

    const second = runBuild(buildScript, fakeBin, ["linux-x64"]);
    expect(second.stderr).toContain("retained without rebuild: docks-kit-darwin-arm64");
  });

  it("stays silent when retained binaries match the stamped version", () => {
    const { buildScript, dist, fakeBin } = fixture("1.2.3");
    const retained = join(dist, "docks-kit-darwin-arm64");
    writeFileSync(retained, "same version binary\n");
    chmodSync(retained, 0o755);
    writeFileSync(join(dist, "VERSION"), "1.2.3\n");

    const result = runBuild(buildScript, fakeBin, ["linux-x64"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toContain("retained without rebuild");
    expect(manifestArtifacts(dist)).toEqual(["docks-kit-darwin-arm64", "docks-kit-linux-x64"]);
  });
});
