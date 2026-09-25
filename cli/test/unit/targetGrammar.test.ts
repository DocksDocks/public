import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import type { Ctx } from "../../src/engine-native";
import { p } from "../../src/engine-native/exec";
import { writeHarnessSelection } from "../../src/engine-native/harnesses";
import { kitDbFile } from "../../src/engine-native/kitDb";
import { ExitError, parseArgs } from "../../src/engine-native/parseArgs";
import { makeEngineServices } from "../../src/engine-native/services";
import { kitHome } from "../../src/kitHome";

function targetCtx(
  home: string,
  interactive: boolean,
  echoes: Array<string>,
  errors: Array<string> = [],
): Ctx {
  return {
    repoDir: kitHome(),
    home,
    agentsDir: p(home, ".agents"),
    interactive,
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
    services: makeEngineServices({
      sinks: {
        stderr: (chunk) => void errors.push(stripVTControlCharacters(chunk)),
        stdout: (chunk) => void echoes.push(chunk.replace(/\n$/, "")),
      },
    }),
    targetFilterSet: false,
    syncClaude: false,
    syncCodex: false,
    syncAgents: false,
    syncOmp: false,
    nextStepTriggers: {
      claudePlugins: false,
      claudeRestart: false,
      codexRestart: false,
      skillsRestart: false,
      ompRestart: false,
    },
    failures: [],
  };
}

function selectedTargets(ctx: Ctx) {
  return {
    claude: ctx.syncClaude,
    codex: ctx.syncCodex,
    agents: ctx.syncAgents,
    omp: ctx.syncOmp,
  };
}

describe("sync target grammar", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "docks-kit-targets-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("selects only omp when omp is explicit", () => {
    const ctx = targetCtx(home, false, []);

    parseArgs(ctx, ["omp"]);

    expect(selectedTargets(ctx)).toEqual({ claude: false, codex: false, agents: false, omp: true });
  });

  it("selects exactly explicit claude and codex targets", () => {
    const ctx = targetCtx(home, false, []);

    parseArgs(ctx, ["claude", "codex"]);

    expect(selectedTargets(ctx)).toEqual({ claude: true, codex: true, agents: false, omp: false });
  });

  it("keeps an explicit target after a modifier ahead of a stored selection", () => {
    writeHarnessSelection(home, ["omp"]);
    const ctx = targetCtx(home, false, []);

    parseArgs(ctx, ["--dry-run", "claude"]);

    expect(ctx.dryRun).toBe(true);
    expect(selectedTargets(ctx)).toEqual({ claude: true, codex: false, agents: false, omp: false });
  });

  it("uses a stored omp-only selection for a flag-less parse", () => {
    writeHarnessSelection(home, ["omp"]);
    const ctx = targetCtx(home, false, []);

    parseArgs(ctx, []);

    expect(selectedTargets(ctx)).toEqual({ claude: false, codex: false, agents: false, omp: true });
  });

  it("uses exactly a stored claude and omp selection", () => {
    writeHarnessSelection(home, ["claude", "omp"]);
    const ctx = targetCtx(home, false, []);

    parseArgs(ctx, []);

    expect(selectedTargets(ctx)).toEqual({ claude: true, codex: false, agents: false, omp: true });
  });

  it("uses the legacy selection silently without stored state when non-interactive", () => {
    const echoes: Array<string> = [];
    const ctx = targetCtx(home, false, echoes);

    parseArgs(ctx, []);

    expect(selectedTargets(ctx)).toEqual({ claude: true, codex: true, agents: true, omp: false });
    expect(echoes).toEqual([]);
  });

  it("prints both selection hints in order without stored state when interactive", () => {
    const echoes: Array<string> = [];
    const ctx = targetCtx(home, true, echoes);

    parseArgs(ctx, []);

    expect(selectedTargets(ctx)).toEqual({ claude: true, codex: true, agents: true, omp: false });
    expect(echoes).toEqual([
      "No harness selection stored; syncing claude, codex, agents",
      "Choose harnesses with: docks-kit harnesses",
    ]);
  });

  it("prints no selection hints for stored state when interactive", () => {
    writeHarnessSelection(home, ["omp"]);
    const echoes: Array<string> = [];
    const ctx = targetCtx(home, true, echoes);

    parseArgs(ctx, []);

    expect(selectedTargets(ctx)).toEqual({ claude: false, codex: false, agents: false, omp: true });

    expect(echoes).toEqual([]);
  });

  it("never creates the harness state file during a flag-less parse", () => {
    const ctx = targetCtx(home, true, []);

    parseArgs(ctx, []);

    expect(existsSync(kitDbFile(home))).toBe(false);
  });

  it("reports unknown positional targets on stderr with exit code 2", () => {
    const errors: Array<string> = [];
    const ctx = targetCtx(home, false, [], errors);
    let thrown: unknown;

    try {
      parseArgs(ctx, ["bogus"]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect((thrown as ExitError).code).toBe(2);
    expect(errors).toEqual(["[err] Unknown arg: bogus\n"]);
  });

  it.each([
    ["--claude-model", "Available claude models", "--claude-model requires a value"],
    ["--codex-model", "Available codex models", "--codex-model requires a value"],
    ["--claude-effort", "Available claude effort levels", "--claude-effort requires a value"],
    ["--codex-effort", "Available codex effort levels", "--codex-effort requires a value"],
    ["--claude-advisor", "Available claude advisor states", "--claude-advisor requires a value"],
  ])(
    "prints the catalog and exits 2 for a bare %s on the native CLI",
    (flag, catalog, diagnostic) => {
      const echoes: Array<string> = [];
      const errors: Array<string> = [];
      const ctx = targetCtx(home, false, echoes, errors);
      let thrown: unknown;

      try {
        parseArgs(ctx, ["claude", flag]);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ExitError);
      expect((thrown as ExitError).code).toBe(2);
      expect(echoes.join("\n")).toContain(catalog);
      expect(errors.join("")).toContain(diagnostic);
    },
  );

  it.each([
    ["--claude-compact-window=abc", "--claude-compact-window expects a token count"],
    ["--claude-permissive=yes", "--claude-permissive does not take a value"],
  ])("rejects invalid native modifier %s before applying it", (flag, diagnostic) => {
    const errors: Array<string> = [];
    const ctx = targetCtx(home, false, [], errors);
    let thrown: unknown;

    try {
      parseArgs(ctx, ["claude", flag]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect((thrown as ExitError).code).toBe(2);
    expect(errors.join("")).toContain(diagnostic);
    expect(ctx.claudeCompactWindow).toBe("");
    expect(ctx.claudePermissive).toBe(false);
  });
});
