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
  // Bulk removal that can empty the home directory.
  "xargs rm",
  "find . -name x | xargs rm",
  "find . -delete",
  "find . -name x -delete",
  "find . -name '*.tmp' -exec rm {} +",
  "find /home/docks -delete",
  "cd /home/docks && find . -delete",
  "/usr/bin/find . -delete",
  "env FOO=1 find . -delete",
  "find /home/docks -type f -exec rm {} +",
  "find . -execdir rm {} ;",
  "find . -ok /bin/rm {} ;",
  "find ~ -type f | xargs rm",
  "git ls-files -z | xargs -0 rm",
  "xargs /bin/rm",
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
  // Every git command that skips the repository's hooks (#111). The
  // NO_VERIFY_SPELLINGS matrix below covers each --no-verify abbreviation; these
  // rows cover its position and a word before git.
  "git push -q origin feat/x --no-verif",
  "git commit -m x --no-veri",
  "git -C ../repo push --no-verify origin feat/x",
  "HUSKY=0 git commit --no-verify -m x",
  "env git push --no-verify origin feat/x",
  "timeout 60 git push --no-verify origin feat/x",
  "/usr/bin/git commit --no-verify -m x",
  // git commit and git am read -n as --no-verify, also inside a cluster.
  "git commit -n -m x",
  "git commit -nm x",
  "git commit -anm x",
  "git commit -vn -m x",
  "git commit -m x -n",
  "git am -n 0001.patch",
  "git am -3n 0001.patch",
  "FOO=1 git commit -n -m x",
  "command git commit -n -m x",
  "/usr/bin/git commit -nm x",
  // A core.hooksPath change moves the hooks directory.
  "git -c core.hooksPath=/dev/null push origin feat/x",
  "git -c core.hookspath=/dev/null commit -m x",
  "git --config-env=core.hooksPath=HOOKS push origin feat/x",
  "git config core.hooksPath /dev/null",
  "git config --unset core.hooksPath",
  "GIT_DIR=.git git -c core.hooksPath=/dev/null push origin feat/x",
  "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git push origin feat/x",
  "GIT_CONFIG_COUNT+=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x",
  "export GIT_CONFIG_COUNT=1",
  `GIT_CONFIG_PARAMETERS="'core.hooksPath'='/dev/null'" git push origin feat/x`,
  `GIT_CONFIG_PARAMETERS="'core.hooksPath=/dev/null'" git push origin feat/x`,
  `env GIT_CONFIG_PARAMETERS="'color.ui=never' 'core.hooksPath'='/dev/null'" git commit -m x`,
  `env GIT_CONFIG_PARAMETERS="'color.ui=never' 'core.hooksPath=/dev/null'" git commit -m x`,
  // Accepted false positives: a cluster of two no-argument options without n,
  // a hooks-path read, another --no-v option, and message text.
  "git commit -aqm x",
  "git config --get core.hooksPath",
  "git merge --no-verify-signatures feat/x",
  'git commit -m "drop --no-verify"',
  'git commit -m "fix -n flag"',
];

const ALLOWED = [
  "trash build",
  // No rule matches these, and yolo runs them. A file removal runs unless it
  // is recursive, runs under sudo, runs through find -delete, find -exec rm,
  // or xargs rm, or names the root or home directory. A dash inside a path is
  // not an option cluster.
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
  "git worktree remove --force -- /home/docks/.local/share/agent-worktrees/repo/feat",
  "find . -name x",
  "find /home/docks/projects -name '*.log'",
  "xargs grep -l TODO",
  "docks-kit scratch new eval",
  "docks-kit scratch remove /tmp/eval-ab12",
  "docks-kit scratch remove /home/docks/.cache/docks-kit/scratch/eval-ab12 /home/docks/.cache/docks-kit/scratch/run-cd34",
  "docks-kit tidy --apply",
  "docks-kit tidy --report",
  "git push -u origin feat/fix-flaky",
  "git push -u origin feat/cache-vf",
  "git push -v origin main",
  "git push origin feat/x",
  // The literal-ref form that the omp agent prompt recommends for a branch delete.
  "git push -q origin --delete feat/a feat/b",
  // Commit and config forms that keep the repository's hooks.
  "git commit -m x",
  "git commit -am x",
  "git commit -sm x",
  "git commit -F msg.txt",
  "git commit --amend --no-edit",
  "git am -3 0001.patch",
  "git am --continue",
  "git log -n 5",
  "git branch -vv",
  "git -c color.ui=never log",
  "git rev-parse --git-path hooks",
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

  // Each spelling skips the hooks on git 2.53.0. git accepts a unique prefix
  // of --no-verify; a shorter prefix is ambiguous with --no-verbose or
  // --no-verify-signatures, except in git am.
  const NO_VERIFY_SPELLINGS = {
    push: ["--no-verify", "--no-verif", "--no-veri"],
    commit: ["--no-verify", "--no-verif", "--no-veri"],
    rebase: ["--no-verify", "--no-verif", "--no-veri"],
    merge: ["--no-verify"],
    pull: ["--no-verify"],
    am: ["--no-verify", "--no-verif", "--no-veri", "--no-ver", "--no-ve", "--no-v"],
  };
  const noVerifyCommands = Object.entries(NO_VERIFY_SPELLINGS).flatMap(([subcommand, spellings]) =>
    spellings.map((spelling) => `git ${subcommand} ${spelling} x`),
  );

  it.each(noVerifyCommands)("asks before %s", (command) => {
    expect(ompYoloOutcome(KIT_RULES, command)).toBe("prompt");
  });

  // git reads a short-option cluster left to right. A no-argument option
  // stands alone; the first option that takes an argument consumes the rest
  // of the word. So a cluster skips the hooks when it reaches n first.
  const SHORT_OPTIONS = {
    commit: { noArgument: "qvseaipnoz", takesArgument: "FmcCtUSu" },
    am: { noArgument: "in3qsukmcr", takesArgument: "CpS" },
  };

  function reachesNoVerify(cluster: string, noArgument: string): boolean {
    for (const option of cluster) {
      if (option === "n") return true;
      if (!noArgument.includes(option)) return false;
    }
    return false;
  }

  function clustersUpTo(alphabet: string, maxLength: number): Array<string> {
    const clusters: Array<string> = [];
    let previous = [""];
    for (let length = 1; length <= maxLength; length++) {
      previous = previous.flatMap((prefix) => [...alphabet].map((option) => prefix + option));
      clusters.push(...previous);
    }
    return clusters;
  }

  // A word before git, such as X=1 or a path, must not hide the cluster.
  function clusterCommands(subcommand: string, cluster: string): Array<string> {
    return [
      `git ${subcommand} -${cluster} x`,
      `git ${subcommand} -q -${cluster} x`,
      `X=1 git ${subcommand} -${cluster} x`,
      `/usr/bin/git ${subcommand} -q -${cluster} x`,
    ];
  }

  it.each(Object.entries(SHORT_OPTIONS))(
    "asks before every git %s short-option cluster that reaches -n",
    (subcommand, { noArgument, takesArgument }) => {
      const commands = clustersUpTo(noArgument + takesArgument, 3)
        .filter((cluster) => reachesNoVerify(cluster, noArgument))
        .flatMap((cluster) => clusterCommands(subcommand, cluster));
      expect(commands.filter((command) => ompYoloOutcome(KIT_RULES, command) !== "prompt")).toEqual(
        [],
      );
    },
  );

  // An option that takes an argument reads the rest of the word as its
  // value, so `git commit -mn x` sets the message "n" and keeps the hooks.
  it.each(Object.entries(SHORT_OPTIONS))(
    "allows every git %s short-option cluster that starts with an option taking an argument",
    (subcommand, { noArgument, takesArgument }) => {
      const commands = clustersUpTo(noArgument + takesArgument, 3)
        .filter((cluster) => takesArgument.includes(cluster[0]!))
        .flatMap((cluster) => clusterCommands(subcommand, cluster));
      expect(commands.filter((command) => ompYoloOutcome(KIT_RULES, command) !== "allow")).toEqual(
        [],
      );
    },
  );

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
