import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"
import { hostOs } from "../../src/engine-native/os/index"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")
const roots: Array<string> = []
const currentHost = hostOs().id
const INSTALL_SH_APPLIES = currentHost === "linux" || currentHost === "darwin"
const installExecutionSuiteLabel = INSTALL_SH_APPLIES
  ? "install.sh execution"
  : "install.sh execution (skipped: install.sh is a POSIX artifact and does not apply to this host)"

/**
 * Resolve a coreutil to its real path. macOS ships `mktemp` in /usr/bin, not
 * /bin, so a hardcoded `/bin/<cmd>` symlink dangles and empties the fixture PATH.
 */
function systemCommand(name: string): string {
  for (const dir of ["/bin", "/usr/bin", "/usr/local/bin"]) {
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`required system command not found: ${name}`)
}

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

  const pathEntries = options.bunInLocalBin
    ? [localBin, fakeBin, "/usr/bin", "/bin"]
    : [fakeBin, "/usr/bin", "/bin"]
  const path = pathEntries.join(delimiter)
  const result = spawnSync("/bin/bash", [installer], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: root,
      PATH: path,
      // find_bun probes $BUN_INSTALL before $HOME/.bun; a developer's real
      // export would otherwise resolve outside the sandbox.
      BUN_INSTALL: join(root, ".bun"),
      FAKE_GLOBAL_BIN_MODE: options.globalBinMode ?? "ok"
    }
  })
  return { root, localBin, result }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("global installer completion", () => {
  it("keeps the PowerShell installer pinned and download-then-run", () => {
    const bashInstaller = readFileSync(join(REPO_DIR, "install.sh"), "utf8")
    const powershellPath = join(REPO_DIR, "install.ps1")
    const powershellInstaller = readFileSync(powershellPath, "utf8")
    const packageSpec = bashInstaller.match(/"\$BUN" add -g ([^\s]+)/)?.[1]

    expect(existsSync(powershellPath)).toBe(true)
    expect(powershellInstaller).toContain(
      `# BEGIN GENERATED BUN PIN\n$BunPin = "${VERIFIED_BUN}"\n# END GENERATED BUN PIN`
    )
    expect(powershellInstaller).toContain(
      "Invoke-WebRequest -Uri 'https://bun.sh/install.ps1' -OutFile $TempInstaller"
    )
    expect(packageSpec).toBe("docks-kit@latest")
    expect(powershellInstaller).toContain(`& $Bun add -g ${packageSpec}`)
    expect(powershellInstaller).toContain(
      `$EscapedInstallBin = $InstallBin.Replace("'", "''")
  [Console]::Error.WriteLine("[Environment]::SetEnvironmentVariable('Path', '$EscapedInstallBin;' + [Environment]::GetEnvironmentVariable('Path', 'User'), 'User')")`
    )
  })

  it.each(["docks-kit.ps1", "install.ps1"])(
    "runs the downloaded Bun installer through an explicit interpreter in %s",
    (script) => {
      const text = readFileSync(join(REPO_DIR, script), "utf8")

      // A downloaded .ps1 carries a Mark-of-the-Web, so a direct `& $TempInstaller`
      // is blocked under the default RemoteSigned policy: Bun never installs and
      // the user gets the no-Bun diagnostic instead. Only this form actually runs,
      // and it matches os/windows.ts bunInstaller.
      expect(text).toContain(
        "& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $TempInstaller -Version $BunPin"
      )
      expect(text).not.toMatch(/^\s*&\s*\$TempInstaller\b/m)
      expect(text).not.toMatch(/\|\s*(?:iex|Invoke-Expression)\b/i)
    }
  )

  describe.skipIf(!INSTALL_SH_APPLIES)(installExecutionSuiteLabel, () => {
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
      symlinkSync(systemCommand(command), join(fakeBin, command))
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
        PATH: fakeBin,
        // This case deliberately keeps Bun off PATH so the bootstrap branch
        // runs; without pinning BUN_INSTALL, find_bun would resolve a real
        // developer install and skip the pinned installer entirely.
        BUN_INSTALL: join(root, ".bun")
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
})
