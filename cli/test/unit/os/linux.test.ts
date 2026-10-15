import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { hostOs, platformName } from "../../../src/engine-native/os";
import { cleanup, runEngine } from "../../lib/goldenExecution";
import { cleanupTemporaryDirs, makeStubDir, materializeVariant } from "../../lib/goldenResources";

afterAll(cleanupTemporaryDirs);

describe("Linux host OS", () => {
  it("maps the Node platform name", () => {
    expect(platformName("linux")).toBe("linux");
  });

  it("exposes every Linux host fact", () => {
    const host = hostOs("linux");

    expect(host.id).toBe("linux");
    expect(host.toolchainOs).toBe("linux");
    expect(host.supportsBubblewrap).toBe(true);
    expect(host.directoryLinkKinds).toEqual(["symlink"]);
    expect(host.executableSuffixes).toEqual([""]);
    expect(host.invoke("/usr/bin/npm", ["-v"])).toEqual({
      command: "/usr/bin/npm",
      args: ["-v"],
    });
    expect(host.bunExecutableName).toBe("bun");
    expect(host.bunInstaller("1.4.0", "/tmp/bun")).toEqual({
      scriptPath: "/tmp/bun/install.sh",
      download: {
        command: "curl",
        args: ["-fsSL", "https://bun.sh/install", "-o", "/tmp/bun/install.sh"],
      },
      run: {
        command: "bash",
        args: ["/tmp/bun/install.sh", "bun-v1.4.0"],
      },
    });
    const setting = host.environmentSetting("ENABLE_CLAUDEAI_MCP_SERVERS", "false");
    expect(setting.kind).toBe("profile");
    if (setting.kind !== "profile") throw new Error("expected a profile environment setting");
    expect(setting.candidates).toEqual([
      ".zshrc",
      ".bashrc",
      ".bash_profile",
      ".profile",
      ".zshenv",
    ]);
    const all = (): boolean => true;
    expect(setting.target(undefined, all)).toBe(".bashrc");
    expect(setting.target("/bin/zsh", all)).toBe(".zshrc");
    expect(setting.target("/usr/local/bin/bash", all)).toBe(".bashrc");
    expect(setting.target("/bin/fish", all)).toBe(".profile");
    expect(setting.line).toBe("export ENABLE_CLAUDEAI_MCP_SERVERS=false");
    expect(
      host.statusLineCommand("/home/test/.bun/bin/bun", "/home/test/.claude/bin/statusline.mjs"),
    ).toBe(
      "test -x '/home/test/.bun/bin/bun' && test -f '/home/test/.claude/bin/statusline.mjs' && exec '/home/test/.bun/bin/bun' '/home/test/.claude/bin/statusline.mjs' || true",
    );
    expect(host.failureHookCommand("echo '{\"ok\":true}'")).toBe("echo '{\"ok\":true}'");
    expect(host.installHint("git")).toBe(
      "sudo apt install -y git (or your distro's package manager)",
    );
    expect(host.installHint("jq")).toBe("sudo apt install -y jq");
    expect(host.installHint("curl")).toBe("sudo apt install -y curl");
    expect(host.installHint("ffplay")).toBe("sudo apt install -y ffmpeg");
    expect(host.installHint("claude")).toBe(
      'tmp=$(mktemp) && curl -fsSL https://claude.ai/install.sh -o "$tmp" && bash "$tmp"',
    );
    expect(host.installHint("codex")).toBe(
      'tmp=$(mktemp) && curl -fsSL https://chatgpt.com/codex/install.sh -o "$tmp" && CODEX_NON_INTERACTIVE=1 sh "$tmp"',
    );
  });

  it("leaves an unsupported platform without a toolchain or bubblewrap capability", () => {
    expect(platformName("freebsd")).toBe("unknown");
    const host = hostOs("unknown");

    expect(host.id).toBe("unknown");
    expect(host.toolchainOs).toBe("");
    expect(host.supportsBubblewrap).toBe(false);
    expect(host.installHint("git")).toBe(
      "sudo apt install -y git (or your distro's package manager)",
    );
  });

  it("writes the connector setting to .bashrc when only a dormant .bash_login holds it", () => {
    // A Linux bash shell does not load .bash_login, so its export does not disable the connectors.
    const home = materializeVariant("home-fresh", {
      ".bash_login": "export ENABLE_CLAUDEAI_MCP_SERVERS=false\n",
    });
    const run = runEngine(["sync", "claude"], home, makeStubDir(), {
      reuseHome: home,
      env: { SHELL: "/bin/bash" },
    });
    try {
      expect(run.exitCode, run.output).toBe(0);
      expect(run.output).toContain("claude.ai connectors disabled via <HOME>/.bashrc");
      expect(readFileSync(join(home, ".bashrc"), "utf8")).toContain(
        "export ENABLE_CLAUDEAI_MCP_SERVERS=false",
      );
    } finally {
      cleanup([run]);
    }
  });
});
