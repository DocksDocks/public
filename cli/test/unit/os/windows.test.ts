import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { hostOs, platformName } from "../../../src/engine-native/os"

/** Stubbed, never inherited: a Windows runner exports its own ComSpec. */
const commandInterpreter = "C:\\Windows\\System32\\cmd.exe"
const inheritedEnv = { ComSpec: process.env["ComSpec"], SystemRoot: process.env["SystemRoot"] }

const setEnv = (values: { ComSpec?: string; SystemRoot?: string }): void => {
  for (const name of ["ComSpec", "SystemRoot"] as const) {
    const value = values[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

beforeEach(() => setEnv({ ComSpec: commandInterpreter }))
afterEach(() => setEnv(inheritedEnv))

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
    ["C:/Program Files/npx.cmd", String.raw`"C:\Program^ Files\npx.cmd ^"--version^""`],
    ["C:/R&D/npx.cmd", String.raw`"C:\R^&D\npx.cmd ^"--version^""`],
    ["C:/O'Brien/npx.cmd", String.raw`"C:\O'Brien\npx.cmd ^"--version^""`],
    ["C:/工具/npx.cmd", String.raw`"C:\工具\npx.cmd ^"--version^""`]
  ])("normalizes and escapes the Windows command shim path: %s", (path, commandLine) => {
    expect(hostOs("windows").invoke(path, ["--version"])).toEqual({
      command: commandInterpreter,
      args: ["/d", "/v:off", "/s", "/c", commandLine],
      windowsVerbatimArguments: true
    })
  })

  it.each([
    ['a "quoted" value', String.raw`"C:\tools\npx.cmd ^"a^ \^"quoted\^"^ value^""`],
    ["a & b", String.raw`"C:\tools\npx.cmd ^"a^ ^&^ b^""`],
    ["a | b", String.raw`"C:\tools\npx.cmd ^"a^ ^|^ b^""`],
    ["a > b", String.raw`"C:\tools\npx.cmd ^"a^ ^>^ b^""`],
    ["a ^ b", String.raw`"C:\tools\npx.cmd ^"a^ ^^^ b^""`],
    ["a ! b", String.raw`"C:\tools\npx.cmd ^"a^ ^!^ b^""`],
    ["trailing\\", String.raw`"C:\tools\npx.cmd ^"trailing\\^""`],
    ["two  spaces", String.raw`"C:\tools\npx.cmd ^"two^ ^ spaces^""`],
    ["工具", String.raw`"C:\tools\npx.cmd ^"工具^""`],
    ["", String.raw`"C:\tools\npx.cmd ^"^""`]
  ])("escapes a Windows command shim argument: %j", (argument, commandLine) => {
    expect(hostOs("windows").invoke("C:/tools/npx.cmd", [argument])).toEqual({
      command: commandInterpreter,
      args: ["/d", "/v:off", "/s", "/c", commandLine],
      windowsVerbatimArguments: true
    })
  })

  it("double-escapes cmd metacharacters only for node_modules command shims", () => {
    expect(hostOs("windows").invoke("C:/project/node_modules/.bin/foo.cmd", ["a & b"])).toEqual({
      command: commandInterpreter,
      args: [
        "/d",
        "/v:off",
        "/s",
        "/c",
        String.raw`"C:\project\node_modules\.bin\foo.cmd ^^^"a^^^ ^^^&^^^ b^^^""`
      ],
      windowsVerbatimArguments: true
    })
    expect(hostOs("windows").invoke("C:/project/bin/foo.cmd", ["a & b"])).toEqual({
      command: commandInterpreter,
      args: [
        "/d",
        "/v:off",
        "/s",
        "/c",
        String.raw`"C:\project\bin\foo.cmd ^"a^ ^&^ b^""`
      ],
      windowsVerbatimArguments: true
    })
  })

  it.each([
    [
      "an argument containing a percent sign",
      "C:/tools/npx.cmd",
      ["100% done"],
      'argument "100% done" contains a percent sign (%), which cannot be escaped on a cmd command line; the caller must pass the value another way.'
    ],
    [
      "an argument containing percent expansion syntax",
      "C:/tools/npx.cmd",
      ["%PATH%"],
      'argument "%PATH%" contains a percent sign (%), which cannot be escaped on a cmd command line; the caller must pass the value another way.'
    ],
    [
      "an executable path containing a percent sign",
      "C:/100%/npx.cmd",
      ["--version"],
      'executable path "C:/100%/npx.cmd" contains a percent sign (%), which cannot be escaped on a cmd command line; the caller must pass the value another way. The tool must be reached through its .exe or moved out of a directory whose name contains a percent sign.'
    ],
    [
      "an argument containing a carriage return",
      "C:/tools/npx.cmd",
      ["line\rbreak"],
      'argument "line\\rbreak" contains a carriage return (CR), which cannot be escaped on a cmd command line; the caller must pass the value another way.'
    ],
    [
      "an argument containing a line feed",
      "C:/tools/npx.cmd",
      ["line\nbreak"],
      'argument "line\\nbreak" contains a line feed (LF), which cannot be escaped on a cmd command line; the caller must pass the value another way.'
    ]
  ])("rejects %s", (_label, executablePath, args, message) => {
    expect(() => hostOs("windows").invoke(executablePath, args)).toThrowError(new Error(message))
  })

  it("invokes an executable directly with its arguments untouched", () => {
    expect(hostOs("windows").invoke("C:/tools/bun.exe", ['a "quoted" value', "a & b", ""])).toEqual({
      command: "C:/tools/bun.exe",
      args: ['a "quoted" value', "a & b", ""]
    })
  })

  it.each([
    ["an absolute ComSpec", { ComSpec: "D:\\tools\\cmd.exe" }, "D:\\tools\\cmd.exe"],
    ["SystemRoot when ComSpec is relative", { ComSpec: "cmd.exe", SystemRoot: "D:\\Windows" }, "D:\\Windows\\System32\\cmd.exe"],
    ["SystemRoot when ComSpec is empty", { ComSpec: "", SystemRoot: "D:\\Windows" }, "D:\\Windows\\System32\\cmd.exe"],
    ["SystemRoot when ComSpec is unset", { SystemRoot: "D:\\Windows" }, "D:\\Windows\\System32\\cmd.exe"],
    ["the standard root when neither is set", {}, "C:\\Windows\\System32\\cmd.exe"]
  ])("resolves an absolute command interpreter from %s", (_label, environment, expected) => {
    setEnv(environment)

    // A pathless interpreter would let the parent's current directory win.
    expect(hostOs("windows").invoke("C:/tools/npx.cmd", ["--version"]).command).toBe(expected)
  })
})
