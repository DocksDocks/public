// No import from "../exec": exec.ts imports "./os", which evaluates linux and darwin
// through this module. A slash join keeps the same host-stable path p() would produce.
import type { HintedTool, HostOs } from "./types";

function posixLiteral(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Package-manager hints for the tools a POSIX host installs through its own package manager. */
export type PackageManagerHints = Readonly<Record<Exclude<HintedTool, "claude" | "codex">, string>>;

const UPSTREAM_INSTALLER_HINTS: Readonly<Record<"claude" | "codex", string>> = {
  claude: 'tmp=$(mktemp) && curl -fsSL https://claude.ai/install.sh -o "$tmp" && bash "$tmp"',
  codex:
    'tmp=$(mktemp) && curl -fsSL https://chatgpt.com/codex/install.sh -o "$tmp" && CODEX_NON_INTERACTIVE=1 sh "$tmp"',
};

interface PosixHostInputs {
  readonly id: HostOs["id"];
  readonly toolchainOs: HostOs["toolchainOs"];
  readonly supportsBubblewrap: boolean;
  readonly packageManagerHints: PackageManagerHints;
  /** Home-relative bash startup files in read order; the first existing one gets the write, else the first entry. */
  readonly bashTargets: readonly [string, ...string[]];
}

/** Members shared by every POSIX host; linux and darwin differ only in the inputs. */
export function posixHost(inputs: PosixHostInputs): HostOs {
  return {
    id: inputs.id,
    toolchainOs: inputs.toolchainOs,
    supportsBubblewrap: inputs.supportsBubblewrap,
    directoryLinkKinds: ["symlink"],
    executableSuffixes: [""],
    invoke: (executablePath, args) => ({ command: executablePath, args }),
    bunExecutableName: "bun",
    bunInstaller: (pin, directory) => {
      const scriptPath = `${directory}/install.sh`;
      return {
        scriptPath,
        download: {
          command: "curl",
          args: ["-fsSL", "https://bun.sh/install", "-o", scriptPath],
        },
        run: {
          command: "bash",
          args: [scriptPath, `bun-v${pin}`],
        },
      };
    },
    environmentSetting: (name, value) => ({
      kind: "profile",
      candidates: [".zshrc", ".bashrc", ".bash_profile", ".bash_login", ".profile", ".zshenv"],
      target: (shell, exists) => {
        const shellPath = shell ?? "bash";
        const shellName = shellPath.slice(shellPath.lastIndexOf("/") + 1);
        if (shellName === "zsh") return ".zshrc";
        if (shellName !== "bash") return ".profile";
        return inputs.bashTargets.find(exists) ?? inputs.bashTargets[0];
      },
      line: `export ${name}=${value}`,
    }),
    statusLineCommand: (bun, script) => {
      const bunLiteral = posixLiteral(bun);
      const scriptLiteral = posixLiteral(script);
      return `test -x ${bunLiteral} && test -f ${scriptLiteral} && exec ${bunLiteral} ${scriptLiteral} || true`;
    },
    failureHookCommand: (command) => command,
    installHint: (tool) =>
      tool === "claude" || tool === "codex"
        ? UPSTREAM_INSTALLER_HINTS[tool]
        : inputs.packageManagerHints[tool],
  };
}
