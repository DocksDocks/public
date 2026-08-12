import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")
const roots: Array<string> = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("compiled binary checksum manifest", () => {
  it("keeps retained target checksums after a subset build", () => {
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

    const retained = join(dist, "docks-kit-darwin-arm64")
    writeFileSync(retained, "retained binary\n")
    chmodSync(retained, 0o755)

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

    const result = spawnSync("/bin/bash", [buildScript, "linux-x64"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}:/usr/bin:/bin` }
    })
    const manifest = readFileSync(join(dist, "SHA256SUMS"), "utf8")

    expect(result.status).toBe(0)
    expect(manifest).toMatch(/  docks-kit-darwin-arm64$/m)
    expect(manifest).toMatch(/  docks-kit-linux-x64$/m)
  })
})
