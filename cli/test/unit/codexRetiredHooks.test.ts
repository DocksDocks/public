import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { codexSync } from "../../src/engine-native/codexSync";
import { DEPENDENCIES } from "../../src/engine-native/deps";
import { p } from "../../src/engine-native/exec";
import type { Ctx } from "../../src/engine-native";
import { makeLogger } from "../../src/engine-native/logger";
import { makePlatform, type EngineServices } from "../../src/engine-native/services";
import { kitHome } from "../../src/kitHome";

const contextCommand = `echo "[CONTEXT] Current date: $(date '+%A, %Y-%m-%d %H:%M:%S %Z')"`;
const configCommand = `echo "[CONFIG] Context: $([ \\"\${CLAUDE_CODE_DISABLE_1M_CONTEXT:-0}\\" = \\"1\\" ] && echo '200K' || echo '1M') | Compact-window: \${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-full} | Effort: \${CLAUDE_CODE_EFFORT_LEVEL:-high} | Thinking: adaptive | Model: \${ANTHROPIC_DEFAULT_OPUS_MODEL:-default} | Subagent: \${CLAUDE_CODE_SUBAGENT_MODEL:-default}"`;
const legacyConfigCommand = configCommand.replace(
  " | Model: ${ANTHROPIC_DEFAULT_OPUS_MODEL:-default}",
  "",
);
const legacyJqConfigCommand = legacyConfigCommand.replace(
  "${CLAUDE_CODE_EFFORT_LEVEL:-high}",
  "${CLAUDE_CODE_EFFORT_LEVEL:-$(jq -r .effortLevel $HOME/.claude/settings.json 2>/dev/null || echo default)}",
);
const skillsCommand = `SKILL_COUNT=$(find .claude/skills -name 'SKILL.md' -mindepth 2 -maxdepth 2 2>/dev/null | wc -l); [ "$SKILL_COUNT" -gt 0 ] && echo "[SKILLS] $SKILL_COUNT project skills available in .claude/skills/. Claude Code loads them on demand via Skill tool. After code changes affecting documented patterns, update the relevant skill and its metadata.updated field." || true`;

function connectorCommand(root: string): string {
  const script = p(root, "home", ".codex", "hooks", "disable-claudeai-connectors.sh");
  return `[ -x '${script}' ] && '${script}' || true`;
}

function testCtx(root: string, stdout: Array<string> = [], stderr: Array<string> = []): Ctx {
  const home = p(root, "home");
  const platform = makePlatform("darwin");
  const services: EngineServices = {
    logger: makeLogger({
      stderr: (chunk) => stderr.push(chunk),
      progress: () => {},
      stdout: (chunk) => stdout.push(chunk),
    }),
    platform,
    deps: {
      spec: (id) => DEPENDENCIES[id],
      probe: () => ({ state: "missing" as const }),
      version: async () => "",
      path: async () => "",
      warnMissing: () => {},
    },
  };
  return {
    repoDir: kitHome(),
    home,
    agentsDir: p(home, ".agents"),
    interactive: false,
    dryRun: false,
    verbose: false,
    skipBubblewrap: false,
    skipPluginRefresh: false,
    reconcile: false,
    prune: false,
    claudeCompactWindow: "",
    claudePermissive: false,
    claudePlugins: [],
    claudeModel: "",
    claudeEffort: "",
    claudeAdvisor: "",
    codexModel: "",
    codexEffort: "",
    syncConcurrency: 3,
    targetFilterSet: true,
    syncClaude: false,
    syncCodex: true,
    syncAgents: false,
    syncOmp: false,
    nextStepTriggers: {
      claudePlugins: false,
      claudeRestart: false,
      codexRestart: false,
      skillsRestart: false,
      ompRestart: false,
    },
    services,
    failures: [],
  };
}

function prepareHooks(root: string, content: string): string {
  const hooks = join(root, "home", ".codex", "hooks.json");
  mkdirSync(join(root, "home", ".codex"), { recursive: true });
  writeFileSync(hooks, content);
  return hooks;
}

describe("retired imported Codex hooks", () => {
  it("removes every recognized legacy handler and preserves user-authored hooks", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-retired-hooks-"));
    const before = `${JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            { hooks: [{ type: "command", command: contextCommand }] },
            { hooks: [{ type: "command", command: "rtk hook claude" }] },
          ],
          SessionStart: [
            {
              hooks: [
                { type: "command", command: contextCommand, timeout: 5 },
                { type: "command", command: configCommand, timeout: 5 },
                { type: "command", command: legacyConfigCommand, timeout: 5 },
                { type: "command", command: legacyJqConfigCommand, timeout: 5 },
                { type: "command", command: skillsCommand, timeout: 5 },
                { type: "command", command: "echo user-session-context", timeout: 5 },
              ],
            },
            { hooks: [{ type: "command", command: connectorCommand(root), timeout: 5 }] },
          ],
        },
      },
      null,
      2,
    )}\n`;
    const hooks = prepareHooks(root, before);
    const ctx = testCtx(root);

    try {
      await codexSync(ctx);
      expect(JSON.parse(readFileSync(hooks, "utf8"))).toEqual({
        hooks: {
          PreToolUse: [
            { hooks: [{ type: "command", command: contextCommand }] },
            { hooks: [{ type: "command", command: "rtk hook claude" }] },
          ],
          SessionStart: [
            { hooks: [{ type: "command", command: "echo user-session-context", timeout: 5 }] },
          ],
        },
      });
      expect(readFileSync(`${hooks}.bak`, "utf8")).toBe(before);
      expect(ctx.nextStepTriggers.codexRestart).toBe(true);

      const after = readFileSync(hooks, "utf8");
      ctx.nextStepTriggers.codexRestart = false;
      await codexSync(ctx);
      expect(readFileSync(hooks, "utf8")).toBe(after);
      expect(readFileSync(`${hooks}.bak`, "utf8")).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("warns and leaves malformed hooks JSON untouched", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-invalid-hooks-"));
    const hooks = prepareHooks(root, "{broken\n");
    const warnings: Array<string> = [];

    try {
      await codexSync(testCtx(root, [], warnings));
      expect(readFileSync(hooks, "utf8")).toBe("{broken\n");
      expect(existsSync(`${hooks}.bak`)).toBe(false);
      expect(warnings.join("")).toContain(
        `Codex hooks file is not a valid JSON object; retired hook cleanup skipped: ${p(root, "home", ".codex", "hooks.json")}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("previews retired hook removal without touching hooks or creating a backup", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-dry-hooks-"));
    const before = `${JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: contextCommand }] }] } })}\n`;
    const hooks = prepareHooks(root, before);
    const output: Array<string> = [];
    const ctx = testCtx(root, output);
    ctx.dryRun = true;

    try {
      await codexSync(ctx);
      expect(readFileSync(hooks, "utf8")).toBe(before);
      expect(existsSync(`${hooks}.bak`)).toBe(false);
      expect(output.join("")).toContain(
        `[dry-run] remove 1 retired imported docks-kit SessionStart hook(s) from ${p(root, "home", ".codex", "hooks.json")}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves customized handlers and same-named scripts outside the imported home path", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-custom-hooks-"));
    const commands = [
      configCommand.replace("Thinking: adaptive", "Thinking: customized"),
      `${connectorCommand(root)}; echo customized`,
      `[ -x '/opt/user/hooks/disable-claudeai-connectors.sh' ] && '/opt/user/hooks/disable-claudeai-connectors.sh' || true`,
    ];
    const before = `${JSON.stringify(
      {
        hooks: {
          SessionStart: [
            { hooks: commands.map((command) => ({ type: "command", command, timeout: 5 })) },
          ],
        },
      },
      null,
      2,
    )}\n`;
    const hooks = prepareHooks(root, before);
    const ctx = testCtx(root);

    try {
      await codexSync(ctx);
      expect(readFileSync(hooks, "utf8")).toBe(before);
      expect(existsSync(`${hooks}.bak`)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
