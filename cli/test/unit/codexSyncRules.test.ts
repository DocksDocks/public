import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { kitHome } from "../../src/kitHome";

type Decision = "allow" | "prompt" | "forbidden";
interface PrefixRule {
  readonly pattern: ReadonlyArray<string>;
  readonly decision: Decision;
}

const RULE_LINE = /^prefix_rule\(pattern=(\[[^\]]*\]), decision="(allow|prompt|forbidden)"\)$/;

const rules: ReadonlyArray<PrefixRule> = readFileSync(
  join(kitHome(), "SoT", ".codex", "rules", "docks.rules"),
  "utf8",
)
  .split("\n")
  .flatMap((line) => {
    const match = RULE_LINE.exec(line);
    if (match === null) return [];
    return [{ pattern: JSON.parse(match[1]!) as Array<string>, decision: match[2] as Decision }];
  });

const STRICTNESS: Readonly<Record<Decision, number>> = { allow: 0, prompt: 1, forbidden: 2 };

/** The decision Codex applies: the strictest rule whose pattern is an argv prefix, if any. */
function decisionFor(argv: ReadonlyArray<string>): Decision | undefined {
  let decision: Decision | undefined;
  for (const rule of rules) {
    if (!rule.pattern.every((token, index) => argv[index] === token)) continue;
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
});
