/**
 * Policy outcomes of the kit's omp `bash.patterns`, evaluated by the ported omp
 * matcher in `../lib/ompBashPatterns`. The kit ships `tools.approvalMode: yolo`,
 * so a command no rule matches runs without a prompt. omp rejects a prompt in a
 * subagent, because a subagent has no interactive UI.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { mergeOmpConfig } from "../../src/engine-native/ompYaml";
import { kitHome } from "../../src/kitHome";
import { ompApproval, type OmpApproval, type OmpBashRule } from "../lib/ompBashPatterns";

const SOT_TEXT = readFileSync(join(kitHome(), "SoT", ".omp", "config.yml"), "utf8");

function isApproval(value: unknown): value is OmpApproval {
  return value === "allow" || value === "prompt" || value === "deny";
}

function bashPatterns(text: string): Array<OmpBashRule> {
  const config: unknown = parse(text);
  const bash =
    typeof config === "object" && config !== null && "bash" in config ? config.bash : undefined;
  const patterns =
    typeof bash === "object" && bash !== null && "patterns" in bash ? bash.patterns : undefined;
  if (!Array.isArray(patterns)) throw new Error("config.yml declares no bash.patterns list");
  return patterns.map((rule: unknown) => {
    if (
      typeof rule !== "object" ||
      rule === null ||
      !("match" in rule) ||
      typeof rule.match !== "string" ||
      !("approval" in rule) ||
      !isApproval(rule.approval)
    ) {
      throw new Error(`malformed bash.patterns entry: ${JSON.stringify(rule)}`);
    }
    return { match: rule.match, approval: rule.approval };
  });
}

const KIT_RULES = bashPatterns(SOT_TEXT);

const OUTCOMES: ReadonlyArray<readonly [string, OmpApproval | undefined]> = [
  ['rm -rf "$HOME"', "deny"],
  ["rm -rf $HOME", "deny"],
  ['rm -rf "${HOME}"', "deny"],
  ['rm -rf "$HOME/"', "deny"],
  ["rm -rf ~", "deny"],
  ["rm -rf ~/", "deny"],
  ["rm -rf /", "deny"],
  ["rm -rf -- /", "deny"],
  ["rm ~", "deny"],
  ['cd /tmp && rm -rf "$HOME"', "deny"],
  ["sudo rm -rf /", "deny"],
  ["/bin/rm -rf ~", "deny"],
  ["export HOME=$(mktemp -d)", "deny"],
  ['HOME=/tmp/fake rm -rf "$HOME"', "deny"],
  ["env HOME=/tmp/fake bun test", "deny"],
  ["git push --force origin main", "deny"],
  ["rm -rf build", "prompt"],
  ["rm -r build", "prompt"],
  ["rm -R build", "prompt"],
  ["rm -fr build", "prompt"],
  ["rm --recursive build", "prompt"],
  ["rm -v -r build", "prompt"],
  ["rm build -rf", "prompt"],
  ["rm -rf /*", "prompt"],
  ["rm -rf ~/projects/tmp", "prompt"],
  ["rm ~/notes.txt", "prompt"],
  ['rm "$HOME/notes.txt"', "prompt"],
  ["find . -name x -delete", "prompt"],
  ["find . -name '*.tmp' -exec rm {} +", "prompt"],
  ["git clean -fdx", "prompt"],
  ["git reset --hard", "prompt"],
  ["git reset --hard HEAD~1", "prompt"],
  ["git push --force origin feat/x", "prompt"],
  ["git push -f origin feat/x", "prompt"],
  ["git push --force-with-lease origin feat/x", "prompt"],
  ["git push origin +feat/x", "prompt"],
  ["gio trash --empty", "prompt"],
  ["gio trash build", "allow"],
  ["trash build", "allow"],
  ["rm file.txt", "allow"],
  ["git rm file.txt", "allow"],
  ["git rm -r --cached dist", "allow"],
  ["git worktree remove ../wt", "allow"],
  ["git push -u origin feat/fix-flaky", undefined],
  ["ls ~", undefined],
];

describe("omp bash.patterns policy", () => {
  it.each(OUTCOMES)("%s -> %s", (command, expected) => {
    expect(ompApproval(KIT_RULES, command)).toBe(expected);
  });

  // First match wins, so a deny must come before every allow and prompt rule.
  it("orders every deny rule before every prompt rule and every prompt rule before every allow rule", () => {
    const rank: Record<OmpApproval, number> = { deny: 0, prompt: 1, allow: 2 };
    const ranks = KIT_RULES.map(({ approval }) => rank[approval]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  // Documented gaps: the matcher has no literal `*`, and a cluster of short
  // options with f in a later place is not spelled out.
  it.each([
    ["rm /*", "allow"],
    ["git push -vf origin feat/x", undefined],
  ] as const)("documented gap: %s -> %s", (command, expected) => {
    expect(ompApproval(KIT_RULES, command)).toBe(expected);
  });
});

describe("omp bash.patterns sync merge", () => {
  const userRules = [
    "bash:",
    "  allowCompoundCommands: false",
    "  patterns:",
    '    - match: "rm -rf build"',
    "      approval: allow",
    '    - match: "gio trash *"',
    "      approval: prompt",
    '    - match: "curl *"',
    "      approval: prompt",
    "",
  ].join("\n");

  it("deploys the kit rules unchanged into a config without bash.patterns", () => {
    expect(bashPatterns(mergeOmpConfig(SOT_TEXT, "userOnly: true\n"))).toEqual(KIT_RULES);
  });

  it("keeps user rules between the kit restrictions and the kit allow rules", () => {
    const merged = mergeOmpConfig(SOT_TEXT, userRules);
    const rules = bashPatterns(merged);
    const restrictions = KIT_RULES.filter(({ approval }) => approval !== "allow");
    const allows = KIT_RULES.filter(({ approval }) => approval === "allow");

    expect(rules).toEqual([
      ...restrictions,
      { match: "rm -rf build", approval: "allow" },
      { match: "gio trash *", approval: "prompt" },
      { match: "curl *", approval: "prompt" },
      ...allows,
    ]);
    expect(parse(merged)).toHaveProperty(["bash", "allowCompoundCommands"], false);
    // A user rule can tighten a kit allow, but cannot loosen a kit prompt.
    expect(ompApproval(rules, "gio trash build")).toBe("prompt");
    expect(ompApproval(rules, "rm -rf build")).toBe("prompt");
    expect(ompApproval(rules, "curl https://example.com")).toBe("prompt");
  });

  it("is idempotent and does not duplicate a deployed kit rule", () => {
    const once = mergeOmpConfig(SOT_TEXT, userRules);
    const twice = mergeOmpConfig(SOT_TEXT, once);

    expect(twice).toBe(once);
    expect(bashPatterns(twice)).toHaveLength(KIT_RULES.length + 3);
  });

  it("treats a respaced or recased copy of a kit rule as the kit rule", () => {
    const deployed = 'bash:\n  patterns:\n    - match: " rm  *   ~"\n      approval: DENY\n';

    expect(bashPatterns(mergeOmpConfig(SOT_TEXT, deployed))).toEqual(KIT_RULES);
  });
});
