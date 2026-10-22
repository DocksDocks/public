import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { hostOs } from "../../src/engine-native/os/index";
import { childEnv } from "../lib/goldenResources";
import { verifiedVersion } from "../lib/toolchainManifest";

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..");
const roots: Array<string> = [];
const currentHost = hostOs().id;
const INSTALL_SH_APPLIES = currentHost === "linux" || currentHost === "darwin";
const installExecutionSuiteLabel = INSTALL_SH_APPLIES
  ? "install.sh execution"
  : "install.sh execution (skipped: install.sh is a POSIX artifact and does not apply to this host)";
const INSTALL_PS1_APPLIES = currentHost === "windows";
const pwshProbe = INSTALL_PS1_APPLIES
  ? spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], {
      encoding: "utf8",
    })
  : null;
const pwshExecutable = pwshProbe?.status === 0 ? "pwsh" : null;
const powershellExecutionSuiteLabel = !INSTALL_PS1_APPLIES
  ? "install.ps1 execution (skipped: install.ps1 is a Windows artifact and does not apply to this host)"
  : pwshExecutable === null
    ? "install.ps1 execution (skipped: install.ps1 requires a resolvable pwsh interpreter)"
    : "install.ps1 execution";
const MATRIX_SENTENCE =
  "docks-kit supports Linux on x64 and arm64, macOS on arm64, and Windows on x64.";

/**
 * Resolve a coreutil to its real path. macOS ships `mktemp` in /usr/bin, not
 * /bin, so a hardcoded `/bin/<cmd>` symlink dangles and empties the fixture PATH.
 */
function systemCommand(name: string): string {
  for (const dir of ["/bin", "/usr/bin", "/usr/local/bin"]) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`required system command not found: ${name}`);
}

const VERIFIED_BUN = verifiedVersion("bun");

type GlobalBinMode = "ok" | "missing" | "failure";

function installerFixture(options: {
  readonly bunInLocalBin?: boolean;
  readonly globalBinMode?: GlobalBinMode;
}) {
  const root = mkdtempSync(join(tmpdir(), "docks-install-"));
  roots.push(root);
  const fakeBin = join(root, "test-bin");
  const localBin = join(root, ".local", "bin");
  const globalBin = join(root, "global-bin");
  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(localBin, { recursive: true });
  mkdirSync(globalBin, { recursive: true });

  const bun = options.bunInLocalBin ? join(localBin, "bun") : join(fakeBin, "bun");
  writeFileSync(
    bun,
    `#!/bin/bash
case "\${1:-}" in
  add) exit 0 ;;
  pm)
    case "\${FAKE_GLOBAL_BIN_MODE:-ok}" in
      failure) exit 19 ;;
      *) printf '%s\\n' '${globalBin}' ;;
    esac
    ;;
  --version) printf '%s\\n' '1.4.0' ;;
  *) exit 2 ;;
esac
`,
  );
  chmodSync(bun, 0o755);

  if ((options.globalBinMode ?? "ok") === "ok") {
    const cli = join(globalBin, "docks-kit");
    writeFileSync(cli, "#!/bin/bash\nprintf '%s\\n' docks-kit\n");
    chmodSync(cli, 0o755);
  }

  const installer = join(root, "install.sh");
  writeFileSync(installer, readFileSync(join(REPO_DIR, "install.sh")));
  chmodSync(installer, 0o755);

  const pathEntries = options.bunInLocalBin
    ? [localBin, fakeBin, "/usr/bin", "/bin"]
    : [fakeBin, "/usr/bin", "/bin"];
  const path = pathEntries.join(delimiter);
  const result = spawnSync("/bin/bash", [installer], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: root,
      PATH: path,
      // find_bun probes $BUN_INSTALL before $HOME/.bun; a developer's real
      // export would otherwise resolve outside the sandbox.
      BUN_INSTALL: join(root, ".bun"),
      FAKE_GLOBAL_BIN_MODE: options.globalBinMode ?? "ok",
    },
  });
  return { root, localBin, result };
}

/**
 * Run install.sh with Bun absent, so the installer takes its bootstrap branch.
 * The curl stub serves a fake Bun installer. The curl stub and the Bun that the
 * fake installer creates record their arguments, so a case can prove which of
 * them ran. The uname stub reports the host that the case names.
 */
function bootstrapInstallerRun(host: { readonly system: string; readonly machine: string }) {
  const root = mkdtempSync(join(tmpdir(), "docks-install-bootstrap-"));
  roots.push(root);
  const fakeBin = join(root, "test-bin");
  const globalBin = join(root, "global-bin");
  const bunDir = join(root, ".bun", "bin");
  const bun = join(bunDir, "bun");
  const recordedArgument = join(root, "bun-installer-argument");
  const curlLog = join(root, "curl-argv.log");
  const bunLog = join(root, "bun-argv.log");
  const downloadedInstaller = join(root, "downloaded-bun-install.sh");
  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(globalBin, { recursive: true });
  for (const command of ["bash", "cat", "chmod", "cp", "ln", "mkdir", "mktemp", "rm"]) {
    symlinkSync(systemCommand(command), join(fakeBin, command));
  }

  const uname = join(fakeBin, "uname");
  writeFileSync(
    uname,
    `#!/bin/bash
case "\${1:-}" in
  -s) printf '%s\\n' '${host.system}' ;;
  -m) printf '%s\\n' '${host.machine}' ;;
  *) exit 2 ;;
esac
`,
  );
  chmodSync(uname, 0o755);

  const cli = join(globalBin, "docks-kit");
  writeFileSync(cli, "#!/bin/bash\nprintf '%s\\n' docks-kit\n");
  chmodSync(cli, 0o755);
  writeFileSync(
    downloadedInstaller,
    `#!/bin/bash
printf '%s\\n' "\${1:-}" > '${recordedArgument}'
mkdir -p '${bunDir}'
cat > '${bun}' <<'BUN'
#!/bin/bash
printf '%s\\n' "$*" >> '${bunLog}'
case "\${1:-}" in
  add) exit 0 ;;
  pm) printf '%s\\n' '${globalBin}' ;;
  --version) printf '%s\\n' '${VERIFIED_BUN}' ;;
  *) exit 2 ;;
esac
BUN
chmod +x '${bun}'
`,
  );

  const curl = join(fakeBin, "curl");
  writeFileSync(
    curl,
    `#!/bin/bash
printf '%s\\n' "$*" >> '${curlLog}'
out=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then
    shift
    out="$1"
    break
  fi
  shift
done
[[ -n "$out" ]] || exit 2
cp '${downloadedInstaller}' "$out"
`,
  );
  chmodSync(curl, 0o755);

  const installer = join(root, "install.sh");
  writeFileSync(installer, readFileSync(join(REPO_DIR, "install.sh")));
  const result = spawnSync("/bin/bash", [installer], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: root,
      PATH: fakeBin,
      // This fixture deliberately keeps Bun off PATH so the bootstrap branch
      // runs; without pinning BUN_INSTALL, find_bun would resolve a real
      // developer install and skip the pinned installer entirely.
      BUN_INSTALL: join(root, ".bun"),
    },
  });
  return { result, recordedArgument, curlLog, bunLog };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("global installer completion", () => {
  it("pins the PowerShell installer to the verified Bun release", () => {
    const powershellInstaller = readFileSync(join(REPO_DIR, "install.ps1"), "utf8");
    expect(powershellInstaller).toContain(
      `# BEGIN GENERATED BUN PIN\n$BunPin = "${VERIFIED_BUN}"\n# END GENERATED BUN PIN`,
    );
  });

  it("pins the CI Bun setup and both cache keys to the verified version", () => {
    // The composite action is hand-maintained, unlike the four generated script
    // pins, so nothing else fails when a bump misses it.
    const action = readFileSync(
      join(REPO_DIR, ".github", "actions", "setup-bun-cache", "action.yml"),
      "utf8",
    );
    const setupVersion = action.match(/bun-version:\s*(\S+)/)?.[1];
    const cacheVersions = [...action.matchAll(/-bun-(\d+\.\d+\.\d+)-/g)].map((match) => match[1]);

    expect(setupVersion).toBe(VERIFIED_BUN);
    expect(cacheVersions).toEqual([VERIFIED_BUN, VERIFIED_BUN]);
  });

  describe.skipIf(!INSTALL_SH_APPLIES)(installExecutionSuiteLabel, () => {
    it("prints the required PATH export instead of an unusable Next command", () => {
      const { root, result } = installerFixture({});

      expect(result.status).toBe(0);
      expect(result.stderr).toContain(`export PATH="${root}/.local/bin:$PATH"`);
      expect(result.stderr).not.toContain("docks-kit ready");
      expect(result.stderr).not.toContain("Next:");
    });

    it("passes the generated verified tag to the Bun installer on a supported host", () => {
      const { result, recordedArgument, bunLog } = bootstrapInstallerRun({
        system: "Linux",
        machine: "x86_64",
      });

      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(recordedArgument, "utf8").trim()).toBe(`bun-v${VERIFIED_BUN}`);
      expect(readFileSync(bunLog, "utf8")).toContain("add -g docks-kit@latest");
    });

    it("rejects Darwin-x86_64 before it downloads Bun or runs bun add", () => {
      const { result, curlLog, bunLog } = bootstrapInstallerRun({
        system: "Darwin",
        machine: "x86_64",
      });

      expect(result.status).toBe(1);
      expect(stripVTControlCharacters(result.stderr)).toContain(
        `[err] unsupported host Darwin-x86_64; ${MATRIX_SENTENCE}`,
      );
      expect(result.stderr).not.toContain("docks-kit.ps1");
      expect(existsSync(curlLog), "curl ran").toBe(false);
      expect(existsSync(bunLog), "bun ran").toBe(false);
    });

    it("keeps a reinstall usable when Bun already is the link destination", () => {
      const { localBin, result } = installerFixture({ bunInLocalBin: true });

      expect(result.status).toBe(0);
      expect(existsSync(join(localBin, "bun"))).toBe(true);
      expect(existsSync(join(localBin, "docks-kit"))).toBe(true);
      expect(result.stderr).toContain("docks-kit ready");
      expect(result.stderr).toContain("Next: docks-kit sync");
    });

    it.each([
      ["fails", "failure"],
      ["does not contain docks-kit", "missing"],
    ] as const)("exits nonzero when global-bin discovery %s", (_label, globalBinMode) => {
      const { result } = installerFixture({ globalBinMode });

      expect(result.status).not.toBe(0);
      expect(result.stderr).not.toContain("docks-kit ready");
      expect(result.stderr).not.toContain("Next:");
    });
  });

  describe.skipIf(pwshExecutable === null)(powershellExecutionSuiteLabel, () => {
    it("rejects Windows-ARM64 before it downloads Bun or runs bun add", () => {
      if (pwshExecutable === null)
        throw new Error("install.ps1 requires a resolvable pwsh interpreter");
      const root = mkdtempSync(join(tmpdir(), "docks-install-windows-"));
      roots.push(root);
      const fakeBin = join(root, "test-bin");
      const bunLog = join(root, "bun-argv.log");
      mkdirSync(fakeBin, { recursive: true });
      // This stub shadows a real Bun on PATH, so a missing host check records
      // the `bun add` call here instead of installing the published package.
      writeFileSync(join(fakeBin, "bun.cmd"), `@echo off\r\necho %*>>"${bunLog}"\r\nexit /b 0\r\n`);
      const installer = join(root, "install.ps1");
      copyFileSync(join(REPO_DIR, "install.ps1"), installer);

      const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
      // Assign the two architecture variables inside the session, as the
      // PowerShell launcher suite does, so the case under test owns them.
      const command = [
        "$env:PROCESSOR_ARCHITECTURE='ARM64'",
        "$env:PROCESSOR_ARCHITEW6432=''",
        `& ${literal(installer)}`,
        "exit $LASTEXITCODE",
      ].join("; ");
      const result = spawnSync(
        pwshExecutable,
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
        {
          encoding: "utf8",
          env: childEnv({
            HOME: root,
            USERPROFILE: root,
            BUN_INSTALL: join(root, ".bun"),
            PATH: [fakeBin, process.env.PATH ?? ""].join(delimiter),
          }),
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`[err] unsupported host Windows-ARM64; ${MATRIX_SENTENCE}`);
      expect(result.stderr).not.toContain("Bun not found");
      expect(result.stderr).not.toContain("Installing docks-kit via bun");
      expect(existsSync(bunLog), "bun ran").toBe(false);
    });
  });
});
