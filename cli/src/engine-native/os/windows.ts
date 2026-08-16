import { p } from "../exec"
import type { HostOs } from "./types"

function powershellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function encodedPowerShellCommand(script: string): string {
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`
}

function windowsCommandArgument(value: string): string {
  const escapedQuotes = value.replace(/(\\*)"/g, "$1$1\\\"")
  const escapedTrailingSlashes = escapedQuotes.replace(/(\\*)$/, "$1$1")
  return `"${escapedTrailingSlashes}"`
}

function commandShimInvocation(executablePath: string, args: ReadonlyArray<string>) {
  const commandLine = [executablePath, ...args].map(windowsCommandArgument).join(" ")
  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", `"${commandLine}"`],
    windowsVerbatimArguments: true
  } as const
}

// Authored now, but unreachable until the supported-host admission gate opens.
export const windows: HostOs = {
  id: "windows",
  toolchainOs: "windows",
  supportsBubblewrap: false,
  directoryLinkKinds: ["symlink", "junction"],
  executableSuffixes: [".exe", ".cmd", ".bat", ""],
  invoke: (executablePath, args) =>
    /\.(?:cmd|bat)$/i.test(executablePath)
      ? commandShimInvocation(executablePath, args)
      : { command: executablePath, args },
  bunExecutableName: "bun.exe",
  bunInstaller: (pin, directory) => {
    const scriptPath = p(directory, "install.ps1")
    return {
      scriptPath,
      download: {
        command: "curl",
        args: ["-fsSL", "https://bun.sh/install.ps1", "-o", scriptPath]
      },
      run: {
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          scriptPath,
          "-Version",
          pin
        ]
      }
    }
  },
  environmentSetting: (name, value) => ({
    kind: "command",
    probe: {
      command: "reg",
      args: ["query", "HKCU\\Environment", "/v", name]
    },
    apply: {
      command: "setx",
      args: [name, value]
    },
    location: "user environment",
    manualHint: "set it manually in System Properties > Environment Variables"
  }),
  statusLineCommand: (bun, script) => {
    const bunLiteral = powershellLiteral(bun)
    const scriptLiteral = powershellLiteral(script)
    // Module auto-loading reports "Preparing modules for first use" as a
    // progress record, which a redirected host serializes to stderr as CLIXML.
    // Claude runs this command every turn, and the records recur across runs, so
    // silencing progress inside the stored command keeps its streams clean.
    return encodedPowerShellCommand(
      `$ProgressPreference = 'SilentlyContinue'; if ((Test-Path -LiteralPath ${bunLiteral} -PathType Leaf) -and (Test-Path -LiteralPath ${scriptLiteral} -PathType Leaf)) { & ${bunLiteral} ${scriptLiteral} }`
    )
  },
  failureHookCommand: (command) => {
    const prefix = "echo '"
    if (!command.startsWith(prefix) || !command.endsWith("'")) return command
    const quotedPayload = command.slice(prefix.length, -1)
    const posixApostrophe = `'"'"'`
    if (quotedPayload.replaceAll(posixApostrophe, "").includes("'")) return command
    const payload = quotedPayload.replaceAll(posixApostrophe, "'")
    return encodedPowerShellCommand(`Write-Output ${powershellLiteral(payload)}`)
  },
  installHint: (tool) => {
    switch (tool) {
      case "git":
        return "winget install --id Git.Git -e"
      case "jq":
        return "winget install --id jqlang.jq -e"
      case "curl":
        return "winget install --id cURL.cURL -e"
      case "ffplay":
        return "winget install --id Gyan.FFmpeg -e"
      case "claude":
        return "$tmp = Join-Path $env:TEMP 'claude-install.ps1'; curl.exe -fsSL https://claude.ai/install.ps1 -o $tmp; if ($LASTEXITCODE -eq 0) { powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tmp }"
      case "codex":
        return "$tmp = Join-Path $env:TEMP 'codex-install.ps1'; curl.exe -fsSL https://chatgpt.com/codex/install.ps1 -o $tmp; if ($LASTEXITCODE -eq 0) { $env:CODEX_NON_INTERACTIVE = '1'; powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tmp }"
    }
  }
}
