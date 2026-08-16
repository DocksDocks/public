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
      args: ["/d", "/s", "/c", "\"\"C:/tools/npm.cmd\" \"-v\"\""],
      windowsVerbatimArguments: true
    })
    expect(host.invoke("C:/tools/npm.BAT", ["-v"])).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "\"\"C:/tools/npm.BAT\" \"-v\"\""],
      windowsVerbatimArguments: true
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
    expect(host.environmentSetting("ENABLE_CLAUDEAI_MCP_SERVERS", "false")).toEqual({
      kind: "command",
      probe: {
        command: "reg",
        args: ["query", "HKCU\\Environment", "/v", "ENABLE_CLAUDEAI_MCP_SERVERS"]
      },
      apply: {
        command: "setx",
        args: ["ENABLE_CLAUDEAI_MCP_SERVERS", "false"]
      },
      location: "user environment",
      manualHint: "set it manually in System Properties > Environment Variables"
    })
    expect(host.statusLineCommand("C:/Tools/bun.exe", "C:/Users/test/.claude/bin/statusline.mjs")).toMatch(
      /^powershell\.exe -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/
    )
    expect(host.failureHookCommand("echo unquoted")).toBe("echo unquoted")
    expect(host.installHint("git")).toBe("winget install --id Git.Git -e")
    expect(host.installHint("jq")).toBe("winget install --id jqlang.jq -e")
    expect(host.installHint("curl")).toBe("winget install --id cURL.cURL -e")
    expect(host.installHint("ffplay")).toBe("winget install --id Gyan.FFmpeg -e")
    expect(host.installHint("claude")).toBe(
      "$tmp = Join-Path $env:TEMP 'claude-install.ps1'; curl.exe -fsSL https://claude.ai/install.ps1 -o $tmp; if ($LASTEXITCODE -eq 0) { powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tmp }"
    )
    expect(host.installHint("codex")).toBe(
      "$tmp = Join-Path $env:TEMP 'codex-install.ps1'; curl.exe -fsSL https://chatgpt.com/codex/install.ps1 -o $tmp; if ($LASTEXITCODE -eq 0) { $env:CODEX_NON_INTERACTIVE = '1'; powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tmp }"
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

  it.each([
    "C:/Program Files/npx.cmd",
    "C:/R&D/npx.cmd",
    "C:/O'Brien/npx.cmd",
    "C:/工具/npx.cmd"
  ])("quotes the Windows command shim path safely: %s", (path) => {
    expect(hostOs("windows").invoke(path, ["--version"])).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", `""${path}" "--version""`],
      windowsVerbatimArguments: true
    })
  })
})
