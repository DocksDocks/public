import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { kitHome } from "../../src/kitHome";
import { cleanup, readArgvLog, runEngine, runPublicCli } from "../lib/goldenExecution";
import { cleanupTemporaryDirs, makeStubDir, materializeVariant } from "../lib/goldenResources";
import { stableStringify } from "../lib/goldenSnapshot";
import {
  invalidRules,
  parseRule,
  READ_ONLY_TOOLS,
  ruleMatchesCommand,
} from "../lib/permissionRules";

// The stub launchers and the child must agree on one host. Native pairing runs
// the real host with its own launcher form, so these cases keep their
// harness-CLI coverage on Windows instead of resolving a shell script the
// host cannot execute.
const NATIVE = { nativeHost: true } as const;

afterAll(cleanupTemporaryDirs);

type PermissionListName = "allow" | "deny" | "ask";

interface ClaudeSotSettings {
  readonly permissions: Record<PermissionListName, ReadonlyArray<string>>;
  readonly hooks: {
    readonly PostToolUseFailure: ReadonlyArray<{ readonly matcher?: string }>;
  };
}

const claudeSotSettings = JSON.parse(
  readFileSync(join(kitHome(), "SoT", ".claude", "settings.json"), "utf8"),
) as ClaudeSotSettings;

function removeRunAndVariant(home: string, variant: string): void {
  rmSync(home, { recursive: true, force: true });
  rmSync(variant, { recursive: true, force: true });
}

const ALL_KIT_RULES = (["allow", "deny", "ask"] as const).flatMap(
  (listName) => claudeSotSettings.permissions[listName],
);

describe("Claude settings truth", () => {
  it("ships only rules Claude Code can load", () => {
    expect(invalidRules(ALL_KIT_RULES)).toEqual([]);
  });

  it("allows only reads plus edits inside the working directory", () => {
    const overreaching = claudeSotSettings.permissions.allow.filter((rule) => {
      const parsed = parseRule(rule);
      if (!parsed.ok) return true;
      if (READ_ONLY_TOOLS.some((tool) => tool === parsed.rule.tool)) return false;
      return rule !== "Edit(./)";
    });

    expect(overreaching).toEqual([]);
  });

  it("protects Windows wherever it protects POSIX", () => {
    const deny = claudeSotSettings.permissions.deny;
    const unprotectedOnWindows = deny
      .filter((rule) => rule.startsWith("Bash("))
      .map((rule) => `PowerShell(${rule.slice("Bash(".length, -1)})`)
      .filter((twin) => !deny.includes(twin));

    expect(unprotectedOnWindows).toEqual([]);
  });

  it("denies destructive commands on both shells", () => {
    const deny = claudeSotSettings.permissions.deny;
    const deleteVerbs = ["Remove-Item", "del", "erase", "rd", "ri", "rm", "rmdir"];
    const roots = ["/", "~", "$HOME", "$env:USERPROFILE", "\\", "C:\\"];
    const destructive: Array<[string, string]> = [
      ["Bash", "rm -rf /"],
      ["Bash", "rm -rf ~"],
      ["Bash", "sudo apt install ripgrep"],
      ["Bash", "chmod -R 777 /etc"],
      ["Bash", "mkfs /dev/sda1"],
      ["PowerShell", "sudo shutdown"],
      ["PowerShell", "Invoke-Expression $payload"],
      ["PowerShell", "iex $payload"],
      ["PowerShell", "Format-Volume -DriveLetter D"],
      ["PowerShell", "Start-Process pwsh -Verb RunAs"],
      ...deleteVerbs.flatMap((verb) =>
        roots.flatMap((root): Array<[string, string]> => [
          ["PowerShell", `${verb} -Recurse ${root}`],
          ["PowerShell", `${verb} ${root} -Recurse`],
          ["PowerShell", `${verb} -Path ${root} -Recurse`],
          ["PowerShell", `${verb} -LiteralPath ${root} -Recurse`],
        ]),
      ),
    ];

    expect(
      destructive.filter(
        ([tool, command]) => !deny.some((rule) => ruleMatchesCommand(rule, tool, command)),
      ),
    ).toEqual([]);
  });

  it("leaves an ordinary recursive delete to the classifier", () => {
    const deny = claudeSotSettings.permissions.deny;
    const ordinary: Array<[string, string]> = [
      ["PowerShell", String.raw`Remove-Item C:\Users\me\repo\node_modules -Recurse -Force`],
      ["PowerShell", "Remove-Item ~/projects/tmp -Recurse -Force"],
      ["PowerShell", "Remove-Item /var/tmp/build -Recurse -Force"],
      ["PowerShell", "Remove-Item node_modules -Recurse -Force"],
      ["PowerShell", String.raw`Remove-Item -LiteralPath D:\work\dist -Recurse -Force`],
      ["Bash", "rm -rf node_modules"],
      ["Bash", "rm -rf ./dist"],
    ];

    expect(
      ordinary.flatMap(([tool, command]) =>
        deny.filter((rule) => ruleMatchesCommand(rule, tool, command)),
      ),
    ).toEqual([]);
  });

  it("runs the shell failure hook for Bash and PowerShell", () => {
    expect(claudeSotSettings.hooks.PostToolUseFailure).toEqual(
      expect.arrayContaining([expect.objectContaining({ matcher: "Bash|PowerShell" })]),
    );
  });

  it("model rejects a deployed non-object document without changing it", () => {
    const bytes = "null";
    const variant = materializeVariant("home-fresh", {
      ".claude/settings.json": bytes,
    });
    const run = runPublicCli(["model", "claude", "opus"], variant, makeStubDir());
    try {
      expect(run.exitCode).toBe(1);
      expect(readFileSync(join(run.home, ".claude", "settings.json"), "utf8")).toBe(bytes);
      expect(`${run.stdout}${run.stderr}`).toContain(
        "(--claude-model) <HOME>/.claude/settings.json must contain a JSON object — aborting",
      );
      expect(`${run.stdout}${run.stderr}`).not.toContain("missing — skipped");
    } finally {
      removeRunAndVariant(run.home, variant);
    }
  });

  it("dry-run rejects non-object deployed settings before promising a merge", () => {
    const bytes = "null";
    const variant = materializeVariant("home-fresh", {
      ".claude/settings.json": bytes,
    });
    const run = runEngine(["sync", "claude", "--dry-run"], variant, makeStubDir());
    try {
      expect(run.exitCode).toBe(1);
      expect(readFileSync(join(run.home, ".claude", "settings.json"), "utf8")).toBe(bytes);
      expect(run.output).toContain(
        "Aborting sync: <HOME>/.claude/settings.json must contain a JSON object. Fix it manually or delete it to reinstall.",
      );
      expect(run.output).not.toContain("[dry-run] merge");
    } finally {
      cleanup([run]);
      rmSync(variant, { recursive: true, force: true });
    }
  });

  it("model reports a skip instead of creating missing Claude settings", () => {
    const variant = materializeVariant("home-fresh", {});
    const run = runPublicCli(["model", "claude", "opus"], variant, makeStubDir());
    try {
      expect(run.exitCode).toBe(0);
      expect(`${run.stdout}${run.stderr}`).toContain("missing — skipped");
      expect(existsSync(join(run.home, ".claude", "settings.json"))).toBe(false);
    } finally {
      removeRunAndVariant(run.home, variant);
    }
  });

  it("rejects a non-object Claude state document without replacing it", () => {
    const bytes = "[]";
    const variant = materializeVariant("home-fresh", {
      ".claude/settings.json": "{}\n",
      ".claude.json": bytes,
    });
    const run = runEngine(["sync", "claude"], variant, makeStubDir({}, NATIVE), NATIVE);
    try {
      expect(run.exitCode).toBe(0);
      expect(readFileSync(join(run.home, ".claude.json"), "utf8")).toBe(bytes);
      expect(run.output).toContain("root must be a JSON object");
      expect(run.output).not.toContain("~/.claude.json updated");
    } finally {
      cleanup([run]);
      rmSync(variant, { recursive: true, force: true });
    }
  });

  it("prune keeps an explicitly requested optional plugin and its marketplace", () => {
    const pluginId = "n8n-mcp-skills@n8n-mcp-skills";
    const marketplace = "n8n-mcp-skills";
    const variant = materializeVariant("home-drift", {
      ".claude/plugins/installed_plugins.json": stableStringify({
        plugins: {
          [pluginId]: [{ scope: "user", version: "test" }],
          "user-plugin@userplace": [{ scope: "user", version: "test" }],
        },
      }),
      ".claude/plugins/known_marketplaces.json": stableStringify({
        [marketplace]: { source: "czlonkowski/n8n-skills" },
        userplace: { source: "user/userplace" },
      }),
    });
    const run = runEngine(
      ["sync", "claude", "--prune", "--claude-plugin=n8n"],
      variant,
      makeStubDir({}, NATIVE),
      NATIVE,
    );
    try {
      expect(run.exitCode).toBe(0);
      const argv = readArgvLog(run);
      expect(argv).toContain("claude\tplugin uninstall -y --scope user user-plugin@userplace");
      expect(argv).toContain("claude\tplugin marketplace remove userplace");
      expect(argv).not.toContain(`claude\tplugin uninstall -y --scope user ${pluginId}`);
      expect(argv).not.toContain(`claude\tplugin marketplace remove ${marketplace}`);
    } finally {
      cleanup([run]);
      rmSync(variant, { recursive: true, force: true });
    }
  });
});

describe("Codex settings truth", () => {
  it("model dry-run skips an absent config while sync still previews the model", () => {
    const variant = materializeVariant("home-fresh", {});
    const modelRun = runPublicCli(
      ["model", "codex", "gpt-5.6-sol", "--dry-run"],
      variant,
      makeStubDir(),
    );
    const syncRun = runEngine(
      ["sync", "codex", "--dry-run", "--codex-model=gpt-5.6-sol"],
      variant,
      makeStubDir(),
    );
    try {
      const modelOutput = `${modelRun.stdout}${modelRun.stderr}`;
      expect(modelRun.exitCode).toBe(0);
      expect(modelOutput).toContain("missing — skipped");
      expect(modelOutput).not.toContain("[dry-run] (--codex-model) set model");
      expect(existsSync(join(modelRun.home, ".codex", "config.toml"))).toBe(false);

      expect(syncRun.exitCode).toBe(0);
      expect(syncRun.output).toContain(
        '[dry-run] (--codex-model) set model = "gpt-5.6-sol" in <HOME>/.codex/config.toml',
      );
      expect(syncRun.output).not.toContain("missing — skipped");
      expect(existsSync(join(syncRun.home, ".codex", "config.toml"))).toBe(false);
    } finally {
      rmSync(modelRun.home, { recursive: true, force: true });
      cleanup([syncRun]);
      rmSync(variant, { recursive: true, force: true });
    }
  });
});
