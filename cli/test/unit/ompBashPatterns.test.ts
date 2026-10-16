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
  "rm -ri build",
  "rm -iR build",
  "/bin/rm -Ri build",
  // Recursive removal after another word: a wrapper, find -exec, or git rm.
  "env FOO=1 rm -rf build",
  "xargs rm -rf",
  "nice rm -rf build",
  "command rm -rf b",
  "time rm -rf b",
  "find . -exec rm -rf {} +",
  "git rm -rf dir",
  "git rm -r dir",
  "git rm -r --cached dist",
  "xargs rm --recursive",
  // Shapes omp's critical check flags: a prompt would become an allow.
  "rm -rf /*",
  "rm -rf /home/docks/projects/cache",
  "rm -f /tmp/x.json",
  "rm -f /tmp/*",
  "rm --no-preserve-root -r build",
  "find . -exec rm -rf /tmp/x {} +",
  "xargs rm -f /tmp/a",
  'bash -c "rm -rf /tmp/x"',
  "git rm -rf /home/docks/projects/x/dir",
  // sudo as a word anywhere before rm, plain or by path.
  "sudo rm -rf build",
  "sudo rm notes.txt",
  "sudo -u root rm notes.txt",
  "/usr/bin/sudo rm -rf user-data",
  "/usr/bin/sudo /bin/rm notes.txt",
  "env PATH=/usr/bin sudo rm notes.txt",
  // Force push to main or master.
  "git push --force origin main",
];

const PROMPTED = [
  // History-destroying git.
  "git clean -fdx",
  "git reset --hard",
  "git reset --hard HEAD~1",
  // Every git push spelling that could force.
  "git push --force origin feat/x",
  "git push -f origin feat/x",
  "git push --force-with-lease origin feat/x",
  "git push --fo origin feat/x",
  "git push --for origin feat/x",
  "git push --forc origin feat/x",
  "git push --mirror origin",
  "git push origin +feat/x",
  "git push -vf origin main",
  "git push -vvf origin main",
  "git push -uvfq origin feat/x",
  "git push -uf origin feat/x",
  "git push -fu origin feat/x",
  "git push -ufv origin feat/x",
  "git push -4f origin feat/x",
  "git push origin feat/x -vf",
  'git push "-vf" origin feat/x',
  "git push origin $BRANCH",
  // Accepted false positive: --follow-tags shares the --f prefix.
  "git push --follow-tags origin feat/x",
];

const ALLOWED = [
  "trash build",
  // No rule matches these, and yolo runs them. A file removal runs unless it
  // is recursive, runs under sudo, or names the root or home directory. A
  // dash inside a path is not an option cluster.
  "rm file.txt",
  "rm /home/docks/projects/x/file.txt",
  "rm -- /tmp/x.json",
  "rm -f file.txt",
  "rm a.txt b.txt",
  "rm *",
  "rm ./*",
  "rm -f ./*",
  "rm *.log",
  "rm ~/notes.txt",
  'rm "$HOME/notes.txt"',
  "xargs rm",
  "find . -name x | xargs rm",
  "find . -delete",
  "find . -name x -delete",
  "find . -name '*.tmp' -exec rm {} +",
  "gio trash build",
  "gio trash -- build",
  "gio trash --empty",
  "git rm x",
  "git rm file.txt",
  "git rm -- file.txt",
  "git rm -- my-repo/x",
  "git rm -f file.txt",
  "rm file",
  "rm my-repo/file",
  "docker rm -f c",
  "git worktree remove ../wt",
  "git worktree remove -- ../wt",
  "git worktree remove --force ../wt",
  "git push -u origin feat/fix-flaky",
  "git push -u origin feat/cache-vf",
  "git push -v origin main",
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

  // First match wins. Every deny precedes every prompt, and every prompt
  // precedes every allow, so no kit allow shadows a deny or a prompt.
  it("orders denies first, then prompts, then allows", () => {
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
    '    - match: "trash *"',
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

  it("puts user denies and prompts ahead of every kit allow, and user allows after kit prompts", () => {
    const merged = mergeOmpConfig(SOT_TEXT, userRules);
    const rules = bashPatterns(merged);

    expect(rules).toEqual([
      ...byApproval("deny"),
      { match: "git clean *", approval: "deny" },
      { match: "trash *", approval: "prompt" },
      { match: "curl *", approval: "prompt" },
      ...byApproval("prompt"),
      { match: "rm -rf build", approval: "allow" },
      ...byApproval("allow"),
    ]);
    expect(parse(merged)).toHaveProperty(["bash", "allowCompoundCommands"], false);
    // A user prompt tightens a kit allow; a user allow cannot loosen a kit rule.
    expect(ompYoloOutcome(rules, "trash build")).toBe("prompt");
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
