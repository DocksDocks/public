import { describe, expect, it } from "vitest"
import { hostOs, platformName } from "../../../src/engine-native/os"

describe("Darwin host OS", () => {
  it("maps the Node platform name", () => {
    expect(platformName("darwin")).toBe("darwin")
  })

  it("exposes every Darwin host fact", () => {
    const host = hostOs("darwin")

    expect(host.id).toBe("darwin")
    expect(host.toolchainOs).toBe("darwin")
    expect(host.supportsBubblewrap).toBe(false)
    expect(host.directoryLinkKinds).toEqual(["symlink"])
    expect(host.executableSuffixes).toEqual([""])
    expect(host.invoke("/usr/local/bin/npm", ["-v"])).toEqual({
      command: "/usr/local/bin/npm",
      args: ["-v"]
    })
    expect(host.bunExecutableName).toBe("bun")
    expect(host.bunInstaller("1.4.0", "/tmp/bun")).toEqual({
      scriptPath: "/tmp/bun/install.sh",
      download: {
        command: "curl",
        args: ["-fsSL", "https://bun.sh/install", "-o", "/tmp/bun/install.sh"]
      },
      run: {
        command: "bash",
        args: ["/tmp/bun/install.sh", "bun-v1.4.0"]
      }
    })
    const setting = host.environmentSetting("ENABLE_CLAUDEAI_MCP_SERVERS", "false")
    expect(setting.kind).toBe("profile")
    if (setting.kind !== "profile") throw new Error("expected a profile environment setting")
    expect(setting.candidates).toEqual([".zshrc", ".bashrc", ".bash_profile", ".profile", ".zshenv"])
    expect(setting.target(undefined)).toBe(".bashrc")
    expect(setting.target("/bin/zsh")).toBe(".zshrc")
    expect(setting.target("/usr/local/bin/bash")).toBe(".bashrc")
    expect(setting.target("/bin/fish")).toBe(".profile")
    expect(setting.line).toBe("export ENABLE_CLAUDEAI_MCP_SERVERS=false")
    expect(host.statusLineCommand("/Users/test/.bun/bin/bun", "/Users/test/.claude/bin/statusline.mjs")).toBe(
      "test -x '/Users/test/.bun/bin/bun' && test -f '/Users/test/.claude/bin/statusline.mjs' && exec '/Users/test/.bun/bin/bun' '/Users/test/.claude/bin/statusline.mjs' || true"
    )
    expect(host.failureHookCommand("echo '{\"ok\":true}'")).toBe("echo '{\"ok\":true}'")
    expect(host.installHint("git")).toBe("brew install git")
    expect(host.installHint("jq")).toBe("brew install jq")
    expect(host.installHint("curl")).toBe("brew install curl")
    expect(host.installHint("ffplay")).toBe("brew install ffmpeg")
    expect(host.installHint("claude")).toBe(
      "curl -fsSL https://claude.ai/install.sh -o /tmp/claude-install.sh && bash /tmp/claude-install.sh"
    )
    expect(host.installHint("codex")).toBe(
      'tmp=$(mktemp) && curl -fsSL https://chatgpt.com/codex/install.sh -o "$tmp" && CODEX_NON_INTERACTIVE=1 sh "$tmp"'
    )
    expect(Object.keys(host).sort()).toEqual([
      "bunExecutableName",
      "bunInstaller",
      "directoryLinkKinds",
      "environmentSetting",
      "executableSuffixes",
      "failureHookCommand",
      "id",
      "installHint",
      "invoke",
      "statusLineCommand",
      "supportsBubblewrap",
      "toolchainOs"
    ])
  })
})
