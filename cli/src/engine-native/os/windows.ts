import { win32 } from "node:path";
import { p } from "../exec";
import type { HostOs } from "./types";

function powershellLiteral(value: string): string {
  return `'${value.replace(/['\u2018\u2019\u201A\u201B]/g, "$&$&")}'`;
}

function encodedPowerShellCommand(script: string): string {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
}

/**
 * Windows shim encoding handles three hazards: Windows argv parsing, cmd
 * metacharacter parsing, and percent/newline values that cmd cannot escape.
 * The caret encoders are ported from cross-spawn's escape.js and its
 * parseNonShell assembly; the backslash encoder is a linear MSVCRT pass. Based on:
 * https://github.com/moxystudio/node-cross-spawn
 * https://qntm.org/cmd
 * https://flatt.tech/research/posts/batbadbut-you-cant-securely-execute-commands-on-windows/
 * https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd
 */
const metaCharsRegExp = /([()\][%!^"`<>&|;, *?])/g;

function escapeCommand(arg: string): string {
  return arg.replace(metaCharsRegExp, "^$1");
}

function escapeArgument(arg: string): string {
  // One linear pass applies the MSVCRT argv rules: a backslash run before a
  // quote doubles and gains one escape, and a trailing run doubles before the
  // closing quote. A greedy regex would be quadratic on long backslash runs.
  let out = "";
  let run = 0;
  for (const ch of arg) {
    if (ch === "\\") {
      run++;
      continue;
    }
    out += ch === '"' ? `${"\\".repeat(2 * run + 1)}"` : `${"\\".repeat(run)}${ch}`;
    run = 0;
  }
  arg = out + "\\".repeat(2 * run);
  arg = `"${arg}"`;
  // Two caret layers: the outer cmd removes one layer, and a batch file that
  // forwards `%*` parses the arguments again. The kit cannot see which batch
  // files forward `%*`, so every .cmd/.bat argument gets both layers.
  arg = arg.replace(metaCharsRegExp, "^$1");
  arg = arg.replace(metaCharsRegExp, "^$1");
  return arg;
}

function assertCommandLineValue(value: string, kind: "executable path" | "argument"): void {
  const unsupported = value.includes("%")
    ? "percent sign (%)"
    : value.includes("\r")
      ? "carriage return (CR)"
      : value.includes("\n")
        ? "line feed (LF)"
        : undefined;
  if (unsupported === undefined) return;

  const executablePercentHint =
    kind === "executable path" && unsupported === "percent sign (%)"
      ? " The tool must be reached through its .exe or moved out of a directory whose name contains a percent sign."
      : "";
  throw new Error(
    `${kind} ${JSON.stringify(value)} contains a ${unsupported}, which cannot be escaped on a cmd command line; the caller must pass the value another way.${executablePercentHint}`,
  );
}

/**
 * Always absolute. A pathless name lets CreateProcess and libuv search the
 * parent's current directory before System32, so an untrusted checkout holding
 * a cmd.exe would win. ComSpec is the documented interpreter, honoured only
 * when it is an absolute path; otherwise it is rebuilt under SystemRoot.
 */
function commandInterpreter(environment: NodeJS.ProcessEnv = process.env): string {
  const comSpec = environment["ComSpec"] ?? "";
  if (win32.isAbsolute(comSpec)) return comSpec;
  const systemRoot = environment["SystemRoot"] ?? "";
  const root = win32.isAbsolute(systemRoot) ? systemRoot : "C:\\Windows";
  return win32.join(root, "System32", "cmd.exe");
}

function commandShimInvocation(executablePath: string, args: ReadonlyArray<string>) {
  assertCommandLineValue(executablePath, "executable path");
  for (const arg of args) assertCommandLineValue(arg, "argument");

  const normalizedPath = win32.normalize(executablePath);
  const commandLine = [escapeCommand(normalizedPath), ...args.map(escapeArgument)].join(" ");
  return {
    command: commandInterpreter(),
    args: ["/d", "/v:off", "/s", "/c", `"${commandLine}"`],
    windowsVerbatimArguments: true,
  } as const;
}

// Host module for the windows-x64 target admitted in os/targets.ts.
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
    const scriptPath = p(directory, "install.ps1");
    return {
      scriptPath,
      download: {
        command: "curl",
        args: ["-fsSL", "https://bun.sh/install.ps1", "-o", scriptPath],
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
          pin,
        ],
      },
    };
  },
  environmentSetting: (name, value) => ({
    kind: "command",
    probe: {
      command: "reg",
      args: ["query", "HKCU\\Environment", "/v", name],
    },
    apply: {
      command: "setx",
      args: [name, value],
    },
    location: "user environment",
    manualHint: "set it manually in System Properties > Environment Variables",
  }),
  statusLineCommand: (bun, script) => {
    const bunLiteral = powershellLiteral(bun);
    const scriptLiteral = powershellLiteral(script);
    // Module auto-loading reports "Preparing modules for first use" as a
    // progress record, which a redirected host serializes to stderr as CLIXML.
    // Claude runs this command every turn, and the records recur across runs, so
    // silencing progress inside the stored command keeps its streams clean.
    return encodedPowerShellCommand(
      `$ProgressPreference = 'SilentlyContinue'; if ((Test-Path -LiteralPath ${bunLiteral} -PathType Leaf) -and (Test-Path -LiteralPath ${scriptLiteral} -PathType Leaf)) { & ${bunLiteral} ${scriptLiteral} }`,
    );
  },
  failureHookCommand: (command) => {
    const prefix = "echo '";
    if (!command.startsWith(prefix) || !command.endsWith("'")) return command;
    const quotedPayload = command.slice(prefix.length, -1);
    const posixApostrophe = `'"'"'`;
    if (quotedPayload.replaceAll(posixApostrophe, "").includes("'")) return command;
    const payload = quotedPayload.replaceAll(posixApostrophe, "'");
    return encodedPowerShellCommand(`Write-Output ${powershellLiteral(payload)}`);
  },
  installHint: (tool) => {
    switch (tool) {
      case "git":
        return "winget install --id Git.Git -e";
      case "jq":
        return "winget install --id jqlang.jq -e";
      case "curl":
        return "winget install --id cURL.cURL -e";
      case "ffplay":
        return "winget install --id Gyan.FFmpeg -e";
      case "claude":
        return "$tmp = Join-Path $env:TEMP 'claude-install.ps1'; curl.exe -fsSL https://claude.ai/install.ps1 -o $tmp; if ($LASTEXITCODE -eq 0) { powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tmp }";
      case "codex":
        return "$tmp = Join-Path $env:TEMP 'codex-install.ps1'; curl.exe -fsSL https://chatgpt.com/codex/install.ps1 -o $tmp; if ($LASTEXITCODE -eq 0) { $env:CODEX_NON_INTERACTIVE = '1'; powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tmp }";
    }
  },
};
