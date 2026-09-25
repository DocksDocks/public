import { describe, expect, it, vi } from "vitest";

vi.mock("../../docs/overview.md", () => ({ default: "" }));
vi.mock("../../docs/flags.md", () => ({ default: "" }));
vi.mock("../../docs/modifiers.md", () => ({ default: "" }));
vi.mock("../../docs/models.md", () => ({ default: "" }));
vi.mock("../../docs/toolchain.md", () => ({ default: "" }));
vi.mock("../../docs/plugins.md", () => ({ default: "" }));
vi.mock("../../docs/sync-layers.md", () => ({ default: "" }));
vi.mock("../../docs/install.md", () => ({ default: "" }));
vi.mock("../../docs/platforms.md", () => ({ default: "" }));
vi.mock("../../docs/omp-models.md", () => ({ default: "" }));
vi.mock("../../docs/omp-context.md", () => ({ default: "" }));

import { prepareArgv, subcommandName } from "../../src/argv";

describe("argument validation", () => {
  it.each([
    [
      "joins a dash-leading compact-window value for Effect 4",
      ["sync", "--claude-compact-window", "-1"],
      ["sync", "--claude-compact-window=-1"],
    ],
    [
      "joins multiple dash-leading values during one normalization walk",
      ["sync", "--claude-compact-window", "-1", "--claude-model", "-x"],
      ["sync", "--claude-compact-window=-1", "--claude-model=-x"],
    ],
    [
      "joins an unknown dash-leading model value while preserving later flags",
      ["sync", "--claude-model", "--bogus", "--dry-run"],
      ["sync", "--claude-model=--bogus", "--dry-run"],
    ],
    [
      "accepts repeated uses of the repeatable plugin flag",
      ["sync", "--claude-plugin", "a", "--claude-plugin", "b"],
      ["sync", "--claude-plugin", "a", "--claude-plugin", "b"],
    ],
    ["accepts a command-local short alias", ["sync", "-v"], ["sync", "-v"]],
    ["accepts the global version short alias at the root", ["-v"], ["-v"]],
    ["accepts repeated global help actions unchanged", ["--help", "--help"], ["--help", "--help"]],
    ["accepts the global version short alias after docs", ["docs", "-v"], ["docs", "-v"]],
    ["accepts a global help flag after a subcommand", ["sync", "--help"], ["sync", "--help"]],
    ["accepts the update no-sync flag", ["update", "--no-sync"], ["update", "--no-sync"]],
    [
      "accepts flag-shaped positionals after the delimiter",
      ["sync", "--", "--bogus"],
      ["sync", "--", "--bogus"],
    ],
    [
      "accepts a global value flag before the subcommand unchanged",
      ["--log-level", "debug", "sync"],
      ["--log-level", "debug", "sync"],
    ],
  ] as const)("%s", (_name, input, args) => {
    expect(prepareArgv(input)).toEqual({ kind: "accept", args });
  });

  it.each([
    [
      "rejects legacy --force with its reconcile rename hint",
      "--force",
      "--force was renamed to --reconcile",
    ],
    [
      "rejects legacy --remove-plugins with its prune rename hint",
      "--remove-plugins",
      "--remove-plugins was renamed to --prune (it also removes marketplaces + kit-managed skills)",
    ],
    [
      "rejects legacy --680k with its compact-window rename hint",
      "--680k",
      "--680k was renamed to --claude-compact-window=680k",
    ],
    [
      "rejects legacy --permissive with its claude-permissive rename hint",
      "--permissive",
      "--permissive was renamed to --claude-permissive",
    ],
    [
      "rejects legacy --supabase with its plugin rename hint",
      "--supabase",
      "--supabase was renamed to --claude-plugin=supabase",
    ],
    [
      "rejects legacy --n8n with its plugin rename hint",
      "--n8n",
      "--n8n was renamed to --claude-plugin=n8n",
    ],
    [
      "rejects legacy --skip-rtk with its bubblewrap rename hint",
      "--skip-rtk",
      "--skip-rtk was renamed to --skip-bubblewrap",
    ],
    [
      "rejects legacy --claude with its positional-target rename hint",
      "--claude",
      "--claude was renamed: pass the target as a word, e.g. 'sync claude'",
    ],
    [
      "rejects legacy --codex with its positional-target rename hint",
      "--codex",
      "--codex was renamed: pass the target as a word, e.g. 'sync codex'",
    ],
    [
      "rejects legacy --agents with its positional-target rename hint",
      "--agents",
      "--agents was renamed: pass the target as a word, e.g. 'sync agents'",
    ],
  ] as const)("%s", (_name, flag, message) => {
    expect(prepareArgv(["sync", flag])).toEqual({ kind: "reject", message, exitCode: 2 });
  });

  it.each([
    [
      "rejects an unknown long sync flag and names its scope",
      ["sync", "--bogus"],
      "--bogus",
      "sync",
    ],
    ["rejects an unknown short sync flag and names its scope", ["sync", "-x"], "-x", "sync"],
    [
      "rejects a long name with a single dash and names its scope",
      ["sync", "-dry-run"],
      "-dry-run",
      "sync",
    ],
    [
      "rejects an undeclared boolean negation and names its scope",
      ["sync", "--no-dry-run"],
      "--no-dry-run",
      "sync",
    ],
    [
      "rejects an unknown negation with an inline value before boolean-value validation",
      ["sync", "--no-dry-run=true"],
      "--no-dry-run=true",
      "sync",
    ],
    [
      "rejects an undeclared status negation and names its scope",
      ["status", "--no-json"],
      "--no-json",
      "status",
    ],
    [
      "rejects a sync legacy flag as unknown outside the sync scope",
      ["docs", "--claude"],
      "--claude",
      "docs",
    ],
  ] as const)("%s", (_name, input, flag, command) => {
    expect(prepareArgv(input)).toEqual({
      kind: "reject",
      message: `unknown flag ${flag} for '${command}'`,
      exitCode: 2,
    });
  });

  it("rejects an unknown root flag without a subcommand scope", () => {
    expect(prepareArgv(["--bogus"])).toEqual({
      kind: "reject",
      message: "unknown flag --bogus",
      exitCode: 2,
    });
  });

  it.each([
    [
      "rejects an unknown subcommand before blaming one of its flags",
      ["snyc", "--dry-run"],
      "unknown command 'snyc'",
    ],
    [
      "rejects an Object.prototype name as an unknown subcommand instead of crashing",
      ["toString", "--dry-run"],
      "unknown command 'toString'",
    ],
    [
      "rejects a repeated value-taking global action rather than silently keeping the first",
      ["--completions", "bash", "--completions", "zsh"],
      "flag --completions was given more than once",
    ],
  ] as const)("%s", (_name, input, message) => {
    expect(prepareArgv(input)).toEqual({ kind: "reject", message, exitCode: 2 });
  });

  it.each([
    [
      "rejects an inline value for the sync dry-run boolean",
      ["sync", "--dry-run=false"],
      "--dry-run",
    ],
    ["rejects an inline value for the sync prune boolean", ["sync", "--prune=true"], "--prune"],
    ["rejects an inline value for the status JSON boolean", ["status", "--json=false"], "--json"],
  ] as const)("%s", (_name, input, flag) => {
    expect(prepareArgv(input)).toEqual({
      kind: "reject",
      message: `flag ${flag} does not take a value`,
      exitCode: 2,
    });
  });

  it.each([
    [
      "rejects duplicate uses of a non-repeatable boolean flag",
      ["sync", "--prune", "--prune"],
      "--prune",
    ],
    [
      "rejects duplicate uses of a non-repeatable value flag",
      ["sync", "--claude-model", "a", "--claude-model", "b"],
      "--claude-model",
    ],
    [
      "treats a short alias and its canonical spelling as the same flag",
      ["sync", "-v", "--verbose"],
      "--verbose",
    ],
    [
      "rejects duplicate uses of a non-repeatable global flag",
      ["--log-level", "debug", "--log-level", "info"],
      "--log-level",
    ],
  ] as const)("%s", (_name, input, flag) => {
    expect(prepareArgv(input)).toEqual({
      kind: "reject",
      message: `flag ${flag} was given more than once`,
      exitCode: 2,
    });
  });

  it.each([
    [
      "rejects a compact-window modifier missing its value",
      ["sync", "--claude-compact-window"],
      "--claude-compact-window requires a value: --claude-compact-window=<tokens> (e.g. 680k)",
    ],
    [
      "rejects a Claude plugin modifier missing its value",
      ["sync", "--claude-plugin"],
      "--claude-plugin requires a value: --claude-plugin=<supabase|n8n>",
    ],
  ] as const)("%s", (_name, input, message) => {
    expect(prepareArgv(input)).toEqual({ kind: "reject", message, exitCode: 2 });
  });

  it.each([
    [
      "missing Claude effort",
      ["sync", "--claude-effort"],
      "Available claude effort levels",
      "  high",
      "--claude-effort requires a value: --claude-effort=<low|medium|high|xhigh|default>",
    ],
    [
      "Claude model followed by another flag",
      ["sync", "--claude-model", "--dry-run"],
      "Available claude models",
      "  opus  —",
      "--claude-model requires a value: --claude-model=<model>",
    ],
    [
      "Claude model followed by the delimiter",
      ["sync", "--claude-model", "--"],
      "Available claude models",
      "  opus  —",
      "--claude-model requires a value: --claude-model=<model>",
    ],
    [
      "missing Codex model",
      ["sync", "--codex-model"],
      "Available codex models",
      "  gpt-6-sol  —",
      "--codex-model requires a value: --codex-model=<model>",
    ],
    [
      "missing Claude advisor",
      ["sync", "--claude-advisor"],
      "Available claude advisor states",
      "  off  —",
      "--claude-advisor requires a value: --claude-advisor=<on|off|default>",
    ],
  ] as const)(
    "rejects %s with a catalog and value grammar",
    (_name, input, heading, option, grammar) => {
      const outcome = prepareArgv(input);
      expect(outcome.kind).toBe("reject");
      if (outcome.kind !== "reject") return;
      expect(outcome.exitCode).toBe(2);
      expect(outcome.message.split("\n")[0]).toContain(heading);
      expect(outcome.message).toContain(`\n${option}`);
      expect(outcome.message.split("\n").at(-1)).toBe(grammar);
    },
  );
});

describe("omp passthrough boundary", () => {
  it.each([
    [
      "forwards a short flag tail behind an injected delimiter",
      ["omp", "-p", "hi"],
      ["omp", "--", "-p", "hi"],
    ],
    [
      "keeps a declared value flag and its value before the boundary",
      ["omp", "--model", "x", "-p", "hi"],
      ["omp", "--model", "x", "--", "-p", "hi"],
    ],
    [
      "starts the tail at a positional message",
      ["omp", "fix the bug"],
      ["omp", "--", "fix the bug"],
    ],
    [
      "preserves an explicit delimiter before an omp flag sharing the launcher's name",
      ["omp", "--", "--model", "upstream"],
      ["omp", "--", "--model", "upstream"],
    ],
    ["leaves a lone picker flag unchanged", ["omp", "--pick"], ["omp", "--pick"]],
    ["leaves help unchanged", ["omp", "--help"], ["omp", "--help"]],
    [
      "forwards an undeclared long flag and its value",
      ["omp", "--mode", "json", "-p", "hi"],
      ["omp", "--", "--mode", "json", "-p", "hi"],
    ],
    [
      "forwards omp's own --models without confusing it with --model",
      ["omp", "--models", "a,b"],
      ["omp", "--", "--models", "a,b"],
    ],
    [
      "skips a global option value before locating the omp passthrough",
      ["--log-level", "debug", "omp", "-p", "hi"],
      ["--log-level", "debug", "omp", "--", "-p", "hi"],
    ],
  ] as const)("%s", (_name, input, args) => {
    expect(prepareArgv(input)).toEqual({ kind: "accept", args });
  });
});

describe("subcommand resolution", () => {
  it.each([
    [
      "skips a separate global flag value and resolves sync",
      ["--log-level", "debug", "sync"],
      "sync",
    ],
    ["skips an inline global flag value and resolves sync", ["--log-level=debug", "sync"], "sync"],
    ["uses the first positional word as the subcommand", ["model", "claude", "sync"], "model"],
    ["returns no subcommand for an empty invocation", [], undefined],
    ["returns no subcommand for a root global flag", ["--help"], undefined],
  ] as const)("%s", (_name, input, expected) => {
    expect(subcommandName(input)).toBe(expected);
  });
});
