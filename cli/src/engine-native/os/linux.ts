import { p } from "../exec"
import type { HostOs } from "./types"

function posixLiteral(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

export const linux: HostOs = {
  id: "linux",
  toolchainOs: "linux",
  supportsBubblewrap: true,
  directoryLinkKinds: ["symlink"],
  executableSuffixes: [""],
  invoke: (executablePath, args) => ({ command: executablePath, args }),
  bunExecutableName: "bun",
  bunInstaller: (pin, directory) => {
    const scriptPath = p(directory, "install.sh")
    return {
      scriptPath,
      download: {
        command: "curl",
        args: ["-fsSL", "https://bun.sh/install", "-o", scriptPath]
      },
      run: {
        command: "bash",
        args: [scriptPath, `bun-v${pin}`]
      }
    }
  },
  profileCandidates: [".zshrc", ".bashrc", ".bash_profile", ".profile", ".zshenv"],
  profileTarget: (shell) => {
    const value = shell ?? "bash"
    const shellName = value.slice(value.lastIndexOf("/") + 1)
    return shellName === "zsh" ? ".zshrc" : shellName === "bash" ? ".bashrc" : ".profile"
  },
  environmentExport: (name, value) => `export ${name}=${value}`,
  statusLineCommand: (bun, script) => {
    const bunLiteral = posixLiteral(bun)
    const scriptLiteral = posixLiteral(script)
    return `test -x ${bunLiteral} && test -f ${scriptLiteral} && exec ${bunLiteral} ${scriptLiteral} || true`
  },
  failureHookCommand: (command) => command,
  installHint: (tool) => {
    switch (tool) {
      case "git":
        return "sudo apt install -y git (or your distro's package manager)"
      case "jq":
        return "sudo apt install -y jq"
      case "curl":
        return "sudo apt install -y curl"
      case "ffplay":
        return "sudo apt install -y ffmpeg"
    }
  }
}
