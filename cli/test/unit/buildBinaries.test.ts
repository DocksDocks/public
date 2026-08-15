import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { HOST_TARGETS } from "../../src/engine-native/os/targets"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")
const roots: Array<string> = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): { buildScript: string; dist: string; fakeBin: string } {
  const root = mkdtempSync(join(tmpdir(), "docks-build-"))
  roots.push(root)
  const cliDir = join(root, "cli")
  const dist = join(cliDir, "dist")
  const fakeBin = join(root, "test-bin")
  mkdirSync(dist, { recursive: true })
  mkdirSync(fakeBin, { recursive: true })

  const buildScript = join(cliDir, "build-binaries.sh")
  writeFileSync(buildScript, readFileSync(join(REPO_DIR, "cli", "build-binaries.sh")))
  chmodSync(buildScript, 0o755)

  const bun = join(fakeBin, "bun")
  writeFileSync(bun, `#!/bin/bash
if [[ "\${1:-}" != "build" ]]; then
  exit 0
fi
out=""
while [[ \$# -gt 0 ]]; do
  if [[ "\$1" == "--outfile" ]]; then
    shift
    out="\$1"
    break
  fi
  shift
done
[[ -n "\$out" ]] || exit 2
printf '%s\\n' 'new binary' > "\$out"
chmod +x "\$out"
`)
  chmodSync(bun, 0o755)

  return { buildScript, dist, fakeBin }
}

function runBuild(buildScript: string, fakeBin: string, targets: ReadonlyArray<string> = []) {
  return spawnSync("/bin/bash", [buildScript, ...targets], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${fakeBin}:/usr/bin:/bin` }
  })
}

function manifestArtifacts(dist: string): Array<string> {
  return readFileSync(join(dist, "SHA256SUMS"), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.replace(/^[a-f0-9]+\s+/, ""))
}

describe("compiled binary checksum manifest", () => {
  it("builds every host target by default with deterministic artifact names", () => {
    const { buildScript, dist, fakeBin } = fixture()

    const result = runBuild(buildScript, fakeBin)
    const expected = HOST_TARGETS.map(({ artifact }) => artifact).sort()

    expect(result.status, result.stderr).toBe(0)
    expect(manifestArtifacts(dist)).toEqual(expected)
    for (const artifact of expected) {
      expect(existsSync(join(dist, artifact)), artifact).toBe(true)
    }
  })

  it("keeps retained target checksums after a subset build", () => {
    const { buildScript, dist, fakeBin } = fixture()
    const retained = join(dist, "docks-kit-darwin-arm64")
    writeFileSync(retained, "retained binary\n")
    chmodSync(retained, 0o755)

    const result = runBuild(buildScript, fakeBin, ["linux-x64"])

    expect(result.status, result.stderr).toBe(0)
    expect(manifestArtifacts(dist)).toEqual(["docks-kit-darwin-arm64", "docks-kit-linux-x64"])
  })
})
