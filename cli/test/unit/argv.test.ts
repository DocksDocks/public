import { describe, expect, it, vi } from "vitest"
import type * as EffectCli from "effect/unstable/cli"

vi.mock("../../docs/overview.md", () => ({ default: "" }))
vi.mock("../../docs/flags.md", () => ({ default: "" }))
vi.mock("../../docs/modifiers.md", () => ({ default: "" }))
vi.mock("../../docs/models.md", () => ({ default: "" }))
vi.mock("../../docs/toolchain.md", () => ({ default: "" }))
vi.mock("../../docs/plugins.md", () => ({ default: "" }))
vi.mock("../../docs/sync-layers.md", () => ({ default: "" }))
vi.mock("../../docs/install.md", () => ({ default: "" }))
vi.mock("../../docs/platforms.md", () => ({ default: "" }))

import { prepareArgv, subcommandName } from "../../src/argv"

describe("argument validation", () => {
  it.each([
    [
      "accepts a sync target followed by a declared boolean flag",
      ["sync", "claude", "--dry-run"],
      ["sync", "claude", "--dry-run"]
    ],
    [
      "accepts a declared value flag followed by its value unchanged",
      ["sync", "--claude-model", "opus"],
      ["sync", "--claude-model", "opus"]
    ],
    [
      "accepts the inline form of a declared value flag",
      ["sync", "--claude-model=opus"],
      ["sync", "--claude-model=opus"]
    ],
    [
      "leaves the inline form of a repeatable value flag unchanged for Effect 4",
      ["sync", "--claude-plugin=supabase"],
      ["sync", "--claude-plugin=supabase"]
    ],
    [
      "leaves an explicit empty inline value unchanged for Effect 4 to validate",
      ["sync", "--claude-model="],
      ["sync", "--claude-model="]
    ],
    [
      "joins a dash-leading compact-window value for Effect 4",
      ["sync", "--claude-compact-window", "-1"],
      ["sync", "--claude-compact-window=-1"]
    ],
    [
      "joins multiple dash-leading values during one normalization walk",
      ["sync", "--claude-compact-window", "-1", "--claude-model", "-x"],
      ["sync", "--claude-compact-window=-1", "--claude-model=-x"]
    ],
    [
      "joins an unknown dash-leading model value while preserving later flags",
      ["sync", "--claude-model", "--bogus", "--dry-run"],
      ["sync", "--claude-model=--bogus", "--dry-run"]
    ],
    [
      "accepts repeated uses of the repeatable plugin flag",
      ["sync", "--claude-plugin", "a", "--claude-plugin", "b"],
      ["sync", "--claude-plugin", "a", "--claude-plugin", "b"]
    ],
    ["accepts a command-local short alias", ["sync", "-v"], ["sync", "-v"]],
    ["accepts the global version short alias at the root", ["-v"], ["-v"]],
    ["accepts the global version flag at the root", ["--version"], ["--version"]],
    [
      "accepts repeated global help actions unchanged",
      ["--help", "--help"],
      ["--help", "--help"]
    ],
    [
      "accepts repeated global version actions unchanged",
      ["--version", "--version"],
      ["--version", "--version"]
    ],
    ["accepts the global version short alias after docs", ["docs", "-v"], ["docs", "-v"]],
    ["accepts the global version short alias after status", ["status", "-v"], ["status", "-v"]],
    ["accepts a global help flag after a subcommand", ["sync", "--help"], ["sync", "--help"]],
    ["accepts a sync boolean flag without a value", ["sync", "--dry-run"], ["sync", "--dry-run"]],
    ["accepts the update no-sync flag", ["update", "--no-sync"], ["update", "--no-sync"]],
    [
      "accepts flag-shaped positionals after the delimiter",
      ["sync", "--", "--bogus"],
      ["sync", "--", "--bogus"]
    ],
    [
      "accepts a global value flag before the subcommand unchanged",
      ["--log-level", "debug", "sync"],
      ["--log-level", "debug", "sync"]
    ],
    [
      "accepts an inline global value flag before the subcommand",
      ["--log-level=debug", "sync"],
      ["--log-level=debug", "sync"]
    ]
  ] as const)("%s", (_name, input, args) => {
    expect(prepareArgv(input)).toEqual({ kind: "accept", args })
  })

  it.each([
    ["rejects legacy --force with its reconcile rename hint", "--force", "--force was renamed to --reconcile"],
    [
      "rejects legacy --remove-plugins with its prune rename hint",
      "--remove-plugins",
      "--remove-plugins was renamed to --prune (it also removes marketplaces + kit-managed skills)"
    ],
    [
      "rejects legacy --680k with its compact-window rename hint",
      "--680k",
      "--680k was renamed to --claude-compact-window=680k"
    ],
    [
      "rejects legacy --permissive with its claude-permissive rename hint",
      "--permissive",
      "--permissive was renamed to --claude-permissive"
    ],
    [
      "rejects legacy --supabase with its plugin rename hint",
      "--supabase",
      "--supabase was renamed to --claude-plugin=supabase"
    ],
    [
      "rejects legacy --n8n with its plugin rename hint",
      "--n8n",
      "--n8n was renamed to --claude-plugin=n8n"
    ],
    [
      "rejects legacy --skip-rtk with its bubblewrap rename hint",
      "--skip-rtk",
      "--skip-rtk was renamed to --skip-bubblewrap"
    ],
    [
      "rejects legacy --claude with its positional-target rename hint",
      "--claude",
      "--claude was renamed: pass the target as a word, e.g. 'sync claude'"
    ],
    [
      "rejects legacy --codex with its positional-target rename hint",
      "--codex",
      "--codex was renamed: pass the target as a word, e.g. 'sync codex'"
    ],
    [
      "rejects legacy --agents with its positional-target rename hint",
      "--agents",
      "--agents was renamed: pass the target as a word, e.g. 'sync agents'"
    ]
  ] as const)("%s", (_name, flag, message) => {
    expect(prepareArgv(["sync", flag])).toEqual({ kind: "reject", message, exitCode: 2 })
  })

  it.each([
    ["rejects an unknown long sync flag and names its scope", ["sync", "--bogus"], "--bogus", "sync"],
    ["rejects an unknown short sync flag and names its scope", ["sync", "-x"], "-x", "sync"],
    [
      "rejects a long name with a single dash and names its scope",
      ["sync", "-dry-run"],
      "-dry-run",
      "sync"
    ],
    [
      "rejects an undeclared boolean negation and names its scope",
      ["sync", "--no-dry-run"],
      "--no-dry-run",
      "sync"
    ],
    [
      "rejects an unknown negation with an inline value before boolean-value validation",
      ["sync", "--no-dry-run=true"],
      "--no-dry-run=true",
      "sync"
    ],
    [
      "rejects an undeclared status negation and names its scope",
      ["status", "--no-json"],
      "--no-json",
      "status"
    ],
    [
      "rejects a sync legacy flag as unknown outside the sync scope",
      ["docs", "--claude"],
      "--claude",
      "docs"
    ]
  ] as const)("%s", (_name, input, flag, command) => {
    expect(prepareArgv(input)).toEqual({
      kind: "reject",
      message: `unknown flag ${flag} for '${command}'`,
      exitCode: 2
    })
  })

  it.each([
    [
      "rejects an unknown subcommand before blaming one of its flags",
      ["snyc", "--dry-run"],
      "unknown command 'snyc'"
    ],
    [
      "rejects an Object.prototype name as an unknown subcommand instead of crashing",
      ["toString", "--dry-run"],
      "unknown command 'toString'"
    ],
    [
      "rejects a repeated value-taking global action rather than silently keeping the first",
      ["--completions", "bash", "--completions", "zsh"],
      "flag --completions was given more than once"
    ]
  ] as const)("%s", (_name, input, message) => {
    expect(prepareArgv(input)).toEqual({ kind: "reject", message, exitCode: 2 })
  })

  it.each([
    ["rejects an inline value for the sync dry-run boolean", ["sync", "--dry-run=false"], "--dry-run"],
    ["rejects an inline value for the sync prune boolean", ["sync", "--prune=true"], "--prune"],
    ["rejects an inline value for the status JSON boolean", ["status", "--json=false"], "--json"]
  ] as const)("%s", (_name, input, flag) => {
    expect(prepareArgv(input)).toEqual({
      kind: "reject",
      message: `flag ${flag} does not take a value`,
      exitCode: 2
    })
  })

  it.each([
    [
      "rejects duplicate uses of a non-repeatable boolean flag",
      ["sync", "--prune", "--prune"],
      "--prune"
    ],
    [
      "rejects duplicate uses of a non-repeatable value flag",
      ["sync", "--claude-model", "a", "--claude-model", "b"],
      "--claude-model"
    ],
    [
      "treats a short alias and its canonical spelling as the same flag",
      ["sync", "-v", "--verbose"],
      "--verbose"
    ],
    [
      "rejects duplicate uses of a non-repeatable global flag",
      ["--log-level", "debug", "--log-level", "info"],
      "--log-level"
    ]
  ] as const)("%s", (_name, input, flag) => {
    expect(prepareArgv(input)).toEqual({
      kind: "reject",
      message: `flag ${flag} was given more than once`,
      exitCode: 2
    })
  })

  it.each([
    [
      "rejects a compact-window modifier missing its value",
      ["sync", "--claude-compact-window"],
      "--claude-compact-window requires a value: --claude-compact-window=<tokens> (e.g. 680k)"
    ],
    [
      "rejects a Claude plugin modifier missing its value",
      ["sync", "--claude-plugin"],
      "--claude-plugin requires a value: --claude-plugin=<supabase|n8n>"
    ]
  ] as const)("%s", (_name, input, message) => {
    expect(prepareArgv(input)).toEqual({ kind: "reject", message, exitCode: 2 })
  })

  it.each([
    [
      "rejects a missing Claude effort with its catalog and value grammar",
      ["sync", "--claude-effort"],
      [
        "Available claude effort levels (effortLevel; verified 2026-07-10):",
        "  low",
        "  medium",
        "  high",
        "  xhigh",
        "  default  — SoT: high",
        "--claude-effort requires a value: --claude-effort=<low|medium|high|xhigh|default>"
      ].join("\n"),
      "Available claude effort levels",
      "--claude-effort requires a value"
    ],
    [
      "rejects a Claude model followed by a recognized flag as genuinely missing its value",
      ["sync", "--claude-model", "--dry-run"],
      [
        "Available claude models (kit-verified 2026-07-27 — SoT/models.json):",
        "  best  — Fable 5 where the org has access, latest Opus otherwise (Claude Code >=2.1.170)",
        "  opus  — latest Opus — the kit SoT default (Opus 5 on the Anthropic API from Claude Code >=2.1.219; Opus 4.6 on Microsoft Foundry)",
        "  fable  — Fable 5 — advisor opt-in default; needs org access + Claude Code >=2.1.170",
        "  sonnet  — latest Sonnet (currently Sonnet 5)",
        "  haiku  — latest Haiku (currently Haiku 4.5)",
        "  default  — engine pseudo-value: deletes the deployed model key so the account default applies",
        "  claude-fable-5  — Fable 5",
        "  claude-opus-5  — Opus 5 — needs Claude Code >=2.1.219",
        "  claude-opus-4-8  — Opus 4.8",
        "  claude-sonnet-5  — Sonnet 5",
        "  claude-haiku-4-5-20251001  — Haiku 4.5",
        "--claude-model requires a value: --claude-model=<model>"
      ].join("\n"),
      "Available claude models",
      "--claude-model requires a value"
    ],
    [
      "rejects a Claude model followed by the delimiter as genuinely missing its value",
      ["sync", "--claude-model", "--"],
      [
        "Available claude models (kit-verified 2026-07-27 — SoT/models.json):",
        "  best  — Fable 5 where the org has access, latest Opus otherwise (Claude Code >=2.1.170)",
        "  opus  — latest Opus — the kit SoT default (Opus 5 on the Anthropic API from Claude Code >=2.1.219; Opus 4.6 on Microsoft Foundry)",
        "  fable  — Fable 5 — advisor opt-in default; needs org access + Claude Code >=2.1.170",
        "  sonnet  — latest Sonnet (currently Sonnet 5)",
        "  haiku  — latest Haiku (currently Haiku 4.5)",
        "  default  — engine pseudo-value: deletes the deployed model key so the account default applies",
        "  claude-fable-5  — Fable 5",
        "  claude-opus-5  — Opus 5 — needs Claude Code >=2.1.219",
        "  claude-opus-4-8  — Opus 4.8",
        "  claude-sonnet-5  — Sonnet 5",
        "  claude-haiku-4-5-20251001  — Haiku 4.5",
        "--claude-model requires a value: --claude-model=<model>"
      ].join("\n"),
      "Available claude models",
      "--claude-model requires a value"
    ],
    [
      "rejects a missing Codex model with its catalog and value grammar",
      ["sync", "--codex-model"],
      [
        "Available codex models (kit-verified 2026-07-16 — SoT/models.json):",
        "  gpt-5.6-sol  — GPT-5.6 Sol — frontier, recommended default; the kit SoT pin",
        "  gpt-5.6-terra  — GPT-5.6 Terra — balanced tier",
        "  gpt-5.6-luna  — GPT-5.6 Luna — fast/light tier",
        "  gpt-5.5  — previous generation",
        "  gpt-5.5-codex  — codex-tuned gpt-5.5",
        "  gpt-5.1  — previous generation",
        "  gpt-5  — previous generation",
        "  gpt-5-codex  — codex-tuned gpt-5",
        "--codex-model requires a value: --codex-model=<model>"
      ].join("\n"),
      "Available codex models",
      "--codex-model requires a value"
    ],
    [
      "rejects a missing Claude advisor with its catalog and value grammar",
      ["sync", "--claude-advisor"],
      [
        "Available claude advisor states (advisorModel; verified 2026-07-10):",
        "  on  — set advisorModel: fable",
        "  off  — unset advisorModel",
        "  default  — SoT: off (unset)",
        "--claude-advisor requires a value: --claude-advisor=<on|off|default>"
      ].join("\n"),
      "Available claude advisor states",
      "--claude-advisor requires a value"
    ]
  ] as const)("%s", (_name, input, message, catalogHeading, valueClause) => {
    const rejection = prepareArgv(input)
    expect(rejection).toEqual({ kind: "reject", message, exitCode: 2 })
    expect(rejection.kind).toBe("reject")
    if (rejection.kind === "reject") {
      expect(rejection.message).toContain(catalogHeading)
      expect(rejection.message).toContain(valueClause)
    }
  })
})

describe("subcommand resolution", () => {
  it.each([
    [
      "skips a separate global flag value and resolves sync",
      ["--log-level", "debug", "sync"],
      "sync"
    ],
    ["skips an inline global flag value and resolves sync", ["--log-level=debug", "sync"], "sync"],
    ["uses the first positional word as the subcommand", ["model", "claude", "sync"], "model"],
    ["returns no subcommand for an empty invocation", [], undefined],
    ["returns no subcommand for a root global flag", ["--help"], undefined]
  ] as const)("%s", (_name, input, expected) => {
    expect(subcommandName(input)).toBe(expected)
  })
})

describe("flag-surface derivation", () => {
  it("throws when Effect exposes malformed built-in globals instead of degrading", async () => {
    vi.resetModules()
    vi.doMock("effect/unstable/cli", async () => {
      const actual = await vi.importActual<typeof EffectCli>("effect/unstable/cli")
      return {
        ...actual,
        GlobalFlag: {
          ...actual.GlobalFlag,
          BuiltIns: {}
        }
      }
    })

    try {
      await expect(import("../../src/argv")).rejects.toThrow(
        "Effect CLI did not expose its built-in global flags"
      )
    } finally {
      vi.doUnmock("effect/unstable/cli")
      vi.resetModules()
    }
  })
})