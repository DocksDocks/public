import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { kitHome } from "../../src/kitHome";

type Decision = "allow" | "prompt" | "forbidden";
/** One argv position: a literal token, or a list of alternative tokens. */
type PatternToken = string | ReadonlyArray<string>;
interface PrefixRule {
  readonly pattern: ReadonlyArray<PatternToken>;
  readonly decision: Decision;
}

const RULE_LINE =
  /^prefix_rule\(pattern=(\[.*\]), decision="(allow|prompt|forbidden)"(?:, justification="(?:[^"\\]|\\.)+")?\)$/;

const rules: ReadonlyArray<PrefixRule> = readFileSync(
  join(kitHome(), "SoT", ".codex", "rules", "docks.rules"),
  "utf8",
)
  .split("\n")
  .flatMap((line) => {
    const match = RULE_LINE.exec(line);
    if (match === null) return [];
    return [
      { pattern: JSON.parse(match[1]!) as Array<PatternToken>, decision: match[2] as Decision },
    ];
  });

const STRICTNESS: Readonly<Record<Decision, number>> = { allow: 0, prompt: 1, forbidden: 2 };

/**
 * The decision Codex applies: the strictest rule whose pattern is an argv
 * prefix, if any. A list token matches any one of its alternatives.
 */
function decisionFor(argv: ReadonlyArray<string>): Decision | undefined {
  let decision: Decision | undefined;
  for (const rule of rules) {
    const isPrefix = rule.pattern.every((token, index) => {
      const arg = argv[index];
      if (arg === undefined) return false;
      return typeof token === "string" ? arg === token : token.includes(arg);
    });
    if (!isPrefix) continue;
    if (decision === undefined || STRICTNESS[rule.decision] > STRICTNESS[decision]) {
      decision = rule.decision;
    }
  }
  return decision;
}

describe("Codex docks.rules contract", () => {
  it("parses every prefix_rule line", () => {
    const ruleLines = readFileSync(join(kitHome(), "SoT", ".codex", "rules", "docks.rules"), "utf8")
      .split("\n")
      .filter((line) => line.startsWith("prefix_rule("));
    expect(rules).toHaveLength(ruleLines.length);
  });

  // Each command reaches a write or an exec through a later flag or operand.
  // An allow rule would run it outside the sandbox with no prompt.
  it.each([
    [["git", "grep", "--open-files-in-pager=sh", "-e", "x"]],
    [["git", "grep", "-O", "-e", "x"]],
    [["sort", "-o", "out", "in"]],
    [["sort", "--compress-program=./x.sh", "in"]],
    [["uniq", "in", "out"]],
    [["tree", "-o", "out"]],
    [["git", "diff", "--output=out"]],
    [["git", "log", "--output=out"]],
    [["git", "show", "--output=out"]],
    [["git", "mv", "f", ".git/hooks/post-checkout"]],
    [["rg", "--pre=sh", "x"]],
    [["sed", "-n", "e touch x", "f"]],
  ])("does not allow %j", (argv) => {
    expect(decisionFor(argv)).not.toBe("allow");
  });

  it("prompts before git mv", () => {
    expect(decisionFor(["git", "mv", "a", "b"])).toBe("prompt");
  });

  // Codex splits a `bash -lc` script into argv only when every word is a plain
  // literal. A script with `~`, `$HOME`, a glob, or a substitution reaches the
  // rules as one [shell, -lc, script] invocation, so those cases are written
  // that way here.
  it.each<readonly [ReadonlyArray<string>, Decision | undefined]>([
    [["bash", "-lc", 'rm -rf "$HOME"'], "forbidden"],
    [["zsh", "-lc", "rm -rf $HOME"], "forbidden"],
    [["bash", "-c", 'rm -rf "${HOME}"'], "forbidden"],
    [["bash", "-lc", "rm -rf ~"], "forbidden"],
    [["bash", "-lc", "rm -r -f ~/"], "forbidden"],
    [["bash", "-lc", "rm -rf /*"], "forbidden"],
    [["rm", "-rf", "/"], "forbidden"],
    [["rm", "-r", "-f", "--", "/"], "forbidden"],
    [["bash", "-lc", "export HOME=$(mktemp -d)"], "forbidden"],
    [["git", "push", "--force", "origin", "main"], "forbidden"],
    [["rm", "-rf", "build"], "prompt"],
    [["rm", "file.txt"], "prompt"],
    [["find", ".", "-name", "x", "-delete"], "prompt"],
    [["git", "clean", "-fdx"], "prompt"],
    [["git", "reset", "--hard"], "prompt"],
    [["git", "push", "--force", "origin", "feat/x"], "prompt"],
    [["git", "push", "-vf", "origin", "main"], "prompt"],
    [["gio", "trash", "--empty"], "prompt"],
    [["gio", "trash", "-f", "--empty"], "prompt"],
    [["gio", "trash", "--force", "--empty"], "prompt"],
    [["gio", "trash", "--restore", "trash:///build"], "prompt"],
    [["git", "rm", "file.txt"], "prompt"],
    [["git", "rm", "file.txt", "-f"], "prompt"],
    [["git", "worktree", "remove", "../wt"], "prompt"],
    [["git", "worktree", "remove", "../wt", "--force"], "prompt"],
    [["gio", "trash", "--", "build"], "allow"],
    [["gio", "trash", "--", "--empty"], "allow"],
    [["trash", "build"], "allow"],
    // No rule matches: Codex runs these in the workspace-write sandbox.
    [["gio", "trash", "build"], undefined],
    [["bash", "-lc", 'rm -rf "$HOME" && true'], undefined],
  ])("decides %j as %s", (argv, decision) => {
    expect(decisionFor(argv)).toBe(decision);
  });
});
