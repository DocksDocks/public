import { describe, expect, it } from "vitest"
import { hostOs, platformName } from "../../../src/engine-native/os"

describe("Linux host OS", () => {
  it("maps the Node platform name", () => {
    expect(platformName("linux")).toBe("linux")
  })

  it("exposes every Linux host fact", () => {
    const host = hostOs("linux")

    expect(host.id).toBe("linux")
    expect(host.toolchainOs).toBe("linux")
    expect(host.supportsBubblewrap).toBe(true)
    expect(host.directoryLinkKinds).toEqual(["symlink"])
    expect(host.executableSuffixes).toEqual([""])
    expect(host.invoke("/usr/bin/npm", ["-v"])).toEqual({
      command: "/usr/bin/npm",
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
    expect(host.statusLineCommand("/home/test/.bun/bin/bun", "/home/test/.claude/bin/statusline.mjs")).toBe(
      "test -x '/home/test/.bun/bin/bun' && test -f '/home/test/.claude/bin/statusline.mjs' && exec '/home/test/.bun/bin/bun' '/home/test/.claude/bin/statusline.mjs' || true"
    )
    expect(host.failureHookCommand("echo '{\"ok\":true}'")).toBe("echo '{\"ok\":true}'")
    expect(host.installHint("git")).toBe("sudo apt install -y git (or your distro's package manager)")
    expect(host.installHint("jq")).toBe("sudo apt install -y jq")
    expect(host.installHint("curl")).toBe("sudo apt install -y curl")
    expect(host.installHint("ffplay")).toBe("sudo apt install -y ffmpeg")
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

  it("derives the unknown host from Linux facts with conservative capabilities", () => {
    const host = hostOs("unknown")

    expect(host.id).toBe("unknown")
    expect(host.toolchainOs).toBe("")
    expect(host.supportsBubblewrap).toBe(false)
    expect(host.directoryLinkKinds).toEqual(["symlink"])
    expect(host.executableSuffixes).toEqual([""])
    expect(host.invoke("/usr/bin/npm", ["-v"])).toEqual({
      command: "/usr/bin/npm",
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
    expect(host.statusLineCommand("/home/test/.bun/bin/bun", "/home/test/.claude/bin/statusline.mjs")).toBe(
      "test -x '/home/test/.bun/bin/bun' && test -f '/home/test/.claude/bin/statusline.mjs' && exec '/home/test/.bun/bin/bun' '/home/test/.claude/bin/statusline.mjs' || true"
    )
    expect(host.failureHookCommand("echo '{\"ok\":true}'")).toBe("echo '{\"ok\":true}'")
    expect(host.installHint("git")).toBe("sudo apt install -y git (or your distro's package manager)")
    expect(host.installHint("jq")).toBe("sudo apt install -y jq")
    expect(host.installHint("curl")).toBe("sudo apt install -y curl")
    expect(host.installHint("ffplay")).toBe("sudo apt install -y ffmpeg")
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
