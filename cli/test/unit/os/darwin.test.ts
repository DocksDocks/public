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
    expect(host.bunInstaller("1.3.14", "/tmp/bun")).toEqual({
      scriptPath: "/tmp/bun/install.sh",
      download: {
        command: "curl",
        args: ["-fsSL", "https://bun.sh/install", "-o", "/tmp/bun/install.sh"]
      },
      run: {
        command: "bash",
        args: ["/tmp/bun/install.sh", "bun-v1.3.14"]
      }
    })
    expect(host.profileCandidates).toEqual([".zshrc", ".bashrc", ".bash_profile", ".profile", ".zshenv"])
    expect(host.profileTarget(undefined)).toBe(".bashrc")
    expect(host.profileTarget("/bin/zsh")).toBe(".zshrc")
    expect(host.profileTarget("/usr/local/bin/bash")).toBe(".bashrc")
    expect(host.profileTarget("/bin/fish")).toBe(".profile")
    expect(host.environmentExport("ENABLE_CLAUDEAI_MCP_SERVERS", "false")).toBe(
      "export ENABLE_CLAUDEAI_MCP_SERVERS=false"
    )
    expect(host.statusLineCommand("/Users/test/.bun/bin/bun", "/Users/test/.claude/bin/statusline.mjs")).toBe(
      "test -x '/Users/test/.bun/bin/bun' && test -f '/Users/test/.claude/bin/statusline.mjs' && exec '/Users/test/.bun/bin/bun' '/Users/test/.claude/bin/statusline.mjs' || true"
    )
    expect(host.failureHookCommand("echo '{\"ok\":true}'")).toBe("echo '{\"ok\":true}'")
    expect(host.installHint("git")).toBe("brew install git")
    expect(host.installHint("jq")).toBe("brew install jq")
    expect(host.installHint("curl")).toBe("brew install curl")
    expect(host.installHint("ffplay")).toBe("brew install ffmpeg")
    expect(Object.keys(host).sort()).toEqual([
      "bunExecutableName",
      "bunInstaller",
      "directoryLinkKinds",
      "environmentExport",
      "executableSuffixes",
      "failureHookCommand",
      "id",
      "installHint",
      "invoke",
      "profileCandidates",
      "profileTarget",
      "statusLineCommand",
      "supportsBubblewrap",
      "toolchainOs"
    ])
  })
})
