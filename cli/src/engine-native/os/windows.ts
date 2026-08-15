import { p } from "../exec"
import type { HostOs } from "./types"

function powershellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function encodedPowerShellCommand(script: string): string {
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`
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
      ? { command: "cmd.exe", args: ["/c", executablePath, ...args] }
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
  profileCandidates: [
    "Documents/PowerShell/Microsoft.PowerShell_profile.ps1",
    "Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1"
  ],
  profileTarget: () => "Documents/PowerShell/Microsoft.PowerShell_profile.ps1",
  environmentExport: (name, value) => `$env:${name} = "${value}"`,
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
    }
  }
}
