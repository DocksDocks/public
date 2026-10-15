/**
 * Policy outcomes of the kit's omp `bash.patterns`, resolved by the ported omp
 * approval path in `../lib/ompBashPatterns`: pattern selection, the critical
 * command check, and the kit's `tools.approvalMode: yolo`. Under yolo, a command
 * no rule matches runs, and a critical command that only a prompt rule matches
 * runs too. omp rejects a prompt in a subagent, because a subagent has no
 * interactive UI.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { mergeOmpConfig } from "../../src/engine-native/ompYaml";
import { kitHome } from "../../src/kitHome";
import {
  isOmpCritical,
  ompApproval,
  ompYoloOutcome,
  type OmpApproval,
  type OmpBashRule,
} from "../lib/ompBashPatterns";

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

const DENIED = [
  // The home directory and the filesystem root, in every quoting.
  'rm -rf "$HOME"',
  "rm -rf $HOME",
  'rm -rf "${HOME}"',
  'rm -rf "$HOME/"',
  "rm -rf ~",
  "rm -rf ~/",
  "rm -rf /",
  "rm -rf -- /",
  "rm ~",
  'cd /tmp && rm -rf "$HOME"',
  "/bin/rm -rf ~",
  // HOME reassignment.
  "export HOME=$(mktemp -d)",
  'HOME=/tmp/fake rm -rf "$HOME"',
  "env HOME=/tmp/fake bun test",
  // Recursive removal, by explicit option token.
  "rm -rf build",
  "rm -r build",
  "rm -R build",
  "rm -fr build",
  "rm -rfv build",
  "rm --recursive build",
  "rm -v -r build",
  "rm build -rf",
  "/usr/bin/rm -rf build",
  "rm -rf ~/projects/tmp",
  // Shapes omp's critical check flags: a prompt would become an allow.
  "rm -rf /*",
  "rm -rf /home/docks/projects/cache",
  "rm -f /tmp/x.json",
  "rm -f /tmp/*",
  "rm -- /tmp/x.json",
  "rm --no-preserve-root -r build",
  "sudo rm -rf build",
  "sudo rm notes.txt",
  "find . -exec rm -rf /tmp/x {} +",
  "xargs rm -f /tmp/a",
  'bash -c "rm -rf /tmp/x"',
  // Force push to main or master.
  "git push --force origin main",
];

const PROMPTED = [
  // Every other rm: the kit allows no rm, so a subagent uses the trash.
  "rm file.txt",
  "rm /home/docks/projects/x/file.txt",
  "rm -f file.txt",
  "rm -f readme.md",
  "rm a.txt b.txt",
  "rm *",
  "rm ./*",
  "rm -f ./*",
  "rm ~/notes.txt",
  'rm "$HOME/notes.txt"',
  "rm -ri build",
  "xargs rm",
  "find . -name x | xargs rm",
  "env FOO=1 rm -rf build",
  // Bulk deletion and history-destroying git.
  "find . -name x -delete",
  "find . -name '*.tmp' -exec rm {} +",
  "git clean -fdx",
  "git reset --hard",
  "git reset --hard HEAD~1",
  "git push --force origin feat/x",
  "git push -f origin feat/x",
  "git push --force-with-lease origin feat/x",
  "git push origin +feat/x",
  "git push -vf origin main",
  "git push -uf origin feat/x",
  "git push -fu origin feat/x",
  "git push -ufv origin feat/x",
  "git push origin feat/x -vf",
  // Emptying or restoring the trash.
  "gio trash --empty",
  "gio trash -f --empty",
  "gio trash build --empty",
  "gio trash --restore -f trash:///build",
  // Forced git removal discards uncommitted changes.
  "git rm -f file.txt",
  "git rm file.txt -f",
  "git rm --force file.txt",
  "git rm -rf dir",
  "git rm -q -f file.txt",
  "git worktree remove --force ../wt",
  "git worktree remove -f ../wt",
  "git worktree remove -ff ../wt",
  "git worktree remove ../wt --force",
];

const ALLOWED = [
  "gio trash -- build",
  "gio trash -- /home/docks/projects/x/build",
  "trash build",
  "git rm file.txt",
  "git rm -r --cached dist",
  "git worktree remove ../wt",
  "git worktree remove ../wt-foo",
  // No rule matches these, and yolo runs them.
  "git push -u origin feat/fix-flaky",
  "git push origin feat/x",
  "ls ~",
];

describe("omp bash.patterns policy under yolo", () => {
  it.each(DENIED)("denies %s", (command) => {
    expect(ompYoloOutcome(KIT_RULES, command)).toBe("deny");
  });

  it.each(PROMPTED)("asks before %s", (command) => {
    expect(ompYoloOutcome(KIT_RULES, command)).toBe("prompt");
  });

  it.each(ALLOWED)("allows %s", (command) => {
    expect(ompYoloOutcome(KIT_RULES, command)).toBe("allow");
  });

  // omp returns its bare critical override before a prompt rule, and yolo
  // ignores that override. Each of these commands is critical, so only a deny
  // rule stops it.
  it("denies every corpus command that omp's critical check flags", () => {
    const critical = [...DENIED, ...PROMPTED, ...ALLOWED].filter(isOmpCritical);
    expect(critical.length).toBeGreaterThan(5);
    expect(critical.filter((command) => ompApproval(KIT_RULES, command) !== "deny")).toEqual([]);
  });

  it("models the override: a prompt rule alone lets a critical command run", () => {
    const promptOnly: Array<OmpBashRule> = [{ match: "rm *", approval: "prompt" }];
    expect(ompYoloOutcome(promptOnly, "rm -rf /home/docks/projects/cache")).toBe("allow");
    expect(ompYoloOutcome(promptOnly, "rm -rf build")).toBe("prompt");
  });

  // First match wins, so a deny must come before every allow and prompt rule.
  it("orders every deny rule before every prompt rule and every prompt rule before every allow rule", () => {
    const rank: Record<OmpApproval, number> = { deny: 0, prompt: 1, allow: 2 };
    const ranks = KIT_RULES.map(({ approval }) => rank[approval]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("allows no rm", () => {
    expect(
      KIT_RULES.filter(({ match, approval }) => approval === "allow" && /(^|\/)rm\b/.test(match)),
    ).toEqual([]);
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
    '    - match: "git clean *"',
    "      approval: deny",
    "",
  ].join("\n");

  const byApproval = (approval: OmpApproval): Array<OmpBashRule> =>
    KIT_RULES.filter((rule) => rule.approval === approval);

  it("deploys the kit rules unchanged into a config without bash.patterns", () => {
    expect(bashPatterns(mergeOmpConfig(SOT_TEXT, "userOnly: true\n"))).toEqual(KIT_RULES);
  });

  it("groups kit and user rules by approval so the strictest match wins", () => {
    const merged = mergeOmpConfig(SOT_TEXT, userRules);
    const rules = bashPatterns(merged);

    expect(rules).toEqual([
      ...byApproval("deny"),
      { match: "git clean *", approval: "deny" },
      ...byApproval("prompt"),
      { match: "gio trash *", approval: "prompt" },
      { match: "curl *", approval: "prompt" },
      { match: "rm -rf build", approval: "allow" },
      ...byApproval("allow"),
    ]);
    expect(parse(merged)).toHaveProperty(["bash", "allowCompoundCommands"], false);
    // A user rule tightens a kit allow; a user allow cannot loosen a kit rule.
    expect(ompYoloOutcome(rules, "gio trash -- build")).toBe("prompt");
    expect(ompYoloOutcome(rules, "rm -rf build")).toBe("deny");
    expect(ompYoloOutcome(rules, "curl https://example.com")).toBe("prompt");
  });

  // Migration: a user deny that an older merge left behind a kit prompt rule
  // for the same command moves ahead of that prompt on the next sync.
  it("moves a user deny ahead of a kit prompt that matches the same command", () => {
    const shadowed = [
      "bash:",
      "  patterns:",
      '    - match: "git clean *"',
      "      approval: prompt",
      '    - match: "git clean *"',
      "      approval: deny",
      "",
    ].join("\n");
    expect(ompApproval(bashPatterns(shadowed), "git clean -fdx")).toBe("prompt");

    const rules = bashPatterns(mergeOmpConfig(SOT_TEXT, shadowed));

    expect(ompYoloOutcome(rules, "git clean -fdx")).toBe("deny");
    expect(rules.filter(({ match }) => match === "git clean *")).toEqual([
      { match: "git clean *", approval: "deny" },
      { match: "git clean *", approval: "prompt" },
    ]);
  });

  it("is idempotent and does not duplicate a deployed kit rule", () => {
    const once = mergeOmpConfig(SOT_TEXT, userRules);
    const twice = mergeOmpConfig(SOT_TEXT, once);

    expect(twice).toBe(once);
    expect(bashPatterns(twice)).toHaveLength(KIT_RULES.length + 4);
  });

  it("treats a respaced or recased copy of a kit rule as the kit rule", () => {
    const deployed = 'bash:\n  patterns:\n    - match: " rm  *   ~"\n      approval: DENY\n';

    expect(bashPatterns(mergeOmpConfig(SOT_TEXT, deployed))).toEqual(KIT_RULES);
  });
});
