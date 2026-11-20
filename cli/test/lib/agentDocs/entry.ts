/**
 * The entry that the agent-docs suites spawn: `docks-kit agent-docs <helper> <command> [args]` through the CLI test
 * entry, as the plan suites spawn `docks-kit plan`.
 */
import { spawnSync } from "node:child_process";

import { BUN_RUNTIME, cliEntry } from "../cliEntry";

/** The helper word of `docks-kit agent-docs <helper>`. */
export type Helper = "pr-template" | "verify-skill" | "agent-first" | "bridge-check";

/** The commands of each helper, as its usage line lists them. */
const COMMANDS: Readonly<Record<Helper, string>> = {
  "pr-template": "detect | gate",
  "verify-skill": "detect | write-gate <path>... | entry-gate",
  "agent-first": "detect | check | convert-agent <path>",
  "bridge-check": "audit | verify [--expect <path>]...",
};

/** The usage line, without its newline, that `docks-kit agent-docs <helper>` prints. */
export function usageLine(helper: Helper): string {
  return `usage: docks-kit agent-docs ${helper} ${COMMANDS[helper]}`;
}

export type HelperResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

// A fatal decoder throws on a byte that is not UTF-8, and `ignoreBOM` keeps a leading byte-order mark in the text
// (the default strips it), so equal strings mean equal bytes.
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** The text of output bytes; it throws on a byte that is not UTF-8. */
export const outputText = (bytes: Uint8Array): string => STRICT_UTF8.decode(bytes);

/** Run `docks-kit agent-docs <helper> <args>`. */
export function runHelper(
  helper: Helper,
  args: ReadonlyArray<string>,
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
): HelperResult {
  const result = spawnSync(BUN_RUNTIME, [cliEntry(), "agent-docs", helper, ...args], {
    cwd: options.cwd,
    env: options.env,
  });
  if (result.error !== undefined) throw result.error;
  return {
    status: result.status,
    stdout: outputText(result.stdout),
    stderr: outputText(result.stderr),
  };
}

/**
 * The stderr that the runtime writes before any helper code runs in `options.cwd`: what `bun -e 0` writes there, such
 * as Bun's parse error for an invalid `package.json` in that folder or a parent folder. A compiled binary writes no
 * such text. (`bun -e ''` prints Bun's help instead of running a program, so the probe runs the expression `0`.)
 */
export function runtimeStderr(options: {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}): string {
  const result = spawnSync(BUN_RUNTIME, ["-e", "0"], { cwd: options.cwd, env: options.env });
  if (result.error !== undefined) throw result.error;
  return outputText(result.stderr);
}
