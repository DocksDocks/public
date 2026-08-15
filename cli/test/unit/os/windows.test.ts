import { describe, expect, it } from "vitest"
import { hostOs, platformName } from "../../../src/engine-native/os"

describe("Windows host OS", () => {
  it("maps the Node platform name", () => {
    expect(platformName("win32")).toBe("windows")
  })

  it("exposes every Windows host fact", () => {
    const host = hostOs("windows")

    expect(host.id).toBe("windows")
    expect(host.toolchainOs).toBe("windows")
    expect(host.supportsBubblewrap).toBe(false)
    expect(host.directoryLinkKinds).toEqual(["symlink", "junction"])
    expect(host.executableSuffixes).toEqual([".exe", ".cmd", ".bat", ""])
    expect(host.invoke("C:/tools/npm.cmd", ["-v"])).toEqual({
      command: "cmd.exe",
      args: ["/c", "C:/tools/npm.cmd", "-v"]
    })
    expect(host.invoke("C:/tools/npm.BAT", ["-v"])).toEqual({
      command: "cmd.exe",
      args: ["/c", "C:/tools/npm.BAT", "-v"]
    })
    expect(host.invoke("C:/tools/bun.exe", ["-v"])).toEqual({
      command: "C:/tools/bun.exe",
      args: ["-v"]
    })
    expect(host.bunExecutableName).toBe("bun.exe")
    expect(host.bunInstaller("1.3.14", "C:/Temp/bun")).toEqual({
      scriptPath: "C:/Temp/bun/install.ps1",
      download: {
        command: "curl",
        args: ["-fsSL", "https://bun.sh/install.ps1", "-o", "C:/Temp/bun/install.ps1"]
      },
      run: {
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          "C:/Temp/bun/install.ps1",
          "-Version",
          "1.3.14"
        ]
      }
    })
    expect(host.profileCandidates).toEqual([
      "Documents/PowerShell/Microsoft.PowerShell_profile.ps1",
      "Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1"
    ])
    expect(host.profileTarget(undefined)).toBe("Documents/PowerShell/Microsoft.PowerShell_profile.ps1")
    expect(host.profileTarget("C:/Program Files/PowerShell/7/pwsh.exe")).toBe(
      "Documents/PowerShell/Microsoft.PowerShell_profile.ps1"
    )
    expect(host.environmentExport("ENABLE_CLAUDEAI_MCP_SERVERS", "false")).toBe(
      "$env:ENABLE_CLAUDEAI_MCP_SERVERS = \"false\""
    )
    expect(host.statusLineCommand("C:/Tools/bun.exe", "C:/Users/test/.claude/bin/statusline.mjs")).toMatch(
      /^powershell\.exe -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/
    )
    expect(host.failureHookCommand("echo unquoted")).toBe("echo unquoted")
    expect(host.installHint("git")).toBe("winget install --id Git.Git -e")
    expect(host.installHint("jq")).toBe("winget install --id jqlang.jq -e")
    expect(host.installHint("curl")).toBe("winget install --id cURL.cURL -e")
    expect(host.installHint("ffplay")).toBe("winget install --id Gyan.FFmpeg -e")
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
