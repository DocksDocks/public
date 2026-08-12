import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")
const roots: Array<string> = []

function verifiedBunVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(join(REPO_DIR, "SoT", "toolchain.json"), "utf8"))
  if (!manifest || typeof manifest !== "object" || !("tools" in manifest)) throw new Error("toolchain tools are missing")
  const tools = manifest.tools
  if (!tools || typeof tools !== "object" || !("bun" in tools)) throw new Error("Bun toolchain entry is missing")
  const bun = tools.bun
  if (!bun || typeof bun !== "object" || !("verified" in bun) || typeof bun.verified !== "string") {
    throw new Error("verified Bun version is missing")
  }
  return bun.verified
}

const VERIFIED_BUN = verifiedBunVersion()

type GlobalBinMode = "ok" | "missing" | "failure"

function installerFixture(options: {
  readonly bunInLocalBin?: boolean
  readonly globalBinMode?: GlobalBinMode
}) {
  const root = mkdtempSync(join(tmpdir(), "docks-install-"))
  roots.push(root)
  const fakeBin = join(root, "test-bin")
  const localBin = join(root, ".local", "bin")
  const globalBin = join(root, "global-bin")
  mkdirSync(fakeBin, { recursive: true })
  mkdirSync(localBin, { recursive: true })
  mkdirSync(globalBin, { recursive: true })

  const bun = options.bunInLocalBin ? join(localBin, "bun") : join(fakeBin, "bun")
  writeFileSync(bun, `#!/bin/bash
case "\${1:-}" in
  add) exit 0 ;;
  pm)
    case "\${FAKE_GLOBAL_BIN_MODE:-ok}" in
      failure) exit 19 ;;
      *) printf '%s\\n' '${globalBin}' ;;
    esac
    ;;
  --version) printf '%s\\n' '1.3.14' ;;
  *) exit 2 ;;
esac
`)
  chmodSync(bun, 0o755)

  if ((options.globalBinMode ?? "ok") === "ok") {
    const cli = join(globalBin, "docks-kit")
    writeFileSync(cli, "#!/bin/bash\nprintf '%s\\n' docks-kit\n")
    chmodSync(cli, 0o755)
  }

  const installer = join(root, "install.sh")
  writeFileSync(installer, readFileSync(join(REPO_DIR, "install.sh")))
  chmodSync(installer, 0o755)

  const path = options.bunInLocalBin
    ? `${localBin}:${fakeBin}:/usr/bin:/bin`
    : `${fakeBin}:/usr/bin:/bin`
  const result = spawnSync("/bin/bash", [installer], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: root,
      PATH: path,
      FAKE_GLOBAL_BIN_MODE: options.globalBinMode ?? "ok"
    }
  })
  return { root, localBin, result }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("global installer completion", () => {
  it("prints the required PATH export instead of an unusable Next command", () => {
    const { root, result } = installerFixture({})

    expect(result.status).toBe(0)
    expect(result.stderr).toContain(`export PATH="${root}/.local/bin:$PATH"`)
    expect(result.stderr).not.toContain("docks-kit ready")
    expect(result.stderr).not.toContain("Next:")
  })

  it("passes the generated verified tag to the Bun installer", () => {
    const root = mkdtempSync(join(tmpdir(), "docks-install-pin-"))
    roots.push(root)
    const fakeBin = join(root, "test-bin")
    const globalBin = join(root, "global-bin")
    const bunDir = join(root, ".bun", "bin")
    const bun = join(bunDir, "bun")
    const recordedArgument = join(root, "bun-installer-argument")
    const downloadedInstaller = join(root, "downloaded-bun-install.sh")
    mkdirSync(fakeBin, { recursive: true })
    mkdirSync(globalBin, { recursive: true })
    for (const command of ["bash", "cat", "chmod", "cp", "ln", "mkdir", "mktemp", "rm"]) {
      symlinkSync(`/bin/${command}`, join(fakeBin, command))
    }

    const cli = join(globalBin, "docks-kit")
    writeFileSync(cli, "#!/bin/bash\nprintf '%s\\n' docks-kit\n")
    chmodSync(cli, 0o755)
    writeFileSync(downloadedInstaller, `#!/bin/bash
printf '%s\\n' "\${1:-}" > '${recordedArgument}'
mkdir -p '${bunDir}'
cat > '${bun}' <<'BUN'
#!/bin/bash
case "\${1:-}" in
  add) exit 0 ;;
  pm) printf '%s\\n' '${globalBin}' ;;
  --version) printf '%s\\n' '${VERIFIED_BUN}' ;;
  *) exit 2 ;;
esac
BUN
chmod +x '${bun}'
`)

    const curl = join(fakeBin, "curl")
    writeFileSync(curl, `#!/bin/bash
out=""
while [[ \$# -gt 0 ]]; do
  if [[ "\$1" == "-o" ]]; then
    shift
    out="\$1"
    break
  fi
  shift
done
[[ -n "\$out" ]] || exit 2
cp '${downloadedInstaller}' "\$out"
`)
    chmodSync(curl, 0o755)

    const installer = join(root, "install.sh")
    writeFileSync(installer, readFileSync(join(REPO_DIR, "install.sh")))
    const result = spawnSync("/bin/bash", [installer], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: root,
        PATH: fakeBin
      }
    })

    expect(result.status).toBe(0)
    expect(readFileSync(recordedArgument, "utf8").trim()).toBe(`bun-v${VERIFIED_BUN}`)
  })

  it("keeps a reinstall usable when Bun already is the link destination", () => {
    const { localBin, result } = installerFixture({ bunInLocalBin: true })

    expect(result.status).toBe(0)
    expect(existsSync(join(localBin, "bun"))).toBe(true)
    expect(existsSync(join(localBin, "docks-kit"))).toBe(true)
    expect(result.stderr).toContain("docks-kit ready")
    expect(result.stderr).toContain("Next: docks-kit sync")
  })

  it.each([
    ["fails", "failure"],
    ["does not contain docks-kit", "missing"]
  ] as const)("exits nonzero when global-bin discovery %s", (_label, globalBinMode) => {
    const { result } = installerFixture({ globalBinMode })

    expect(result.status).not.toBe(0)
    expect(result.stderr).not.toContain("docks-kit ready")
    expect(result.stderr).not.toContain("Next:")
  })
})
