# Legacy CLAUDE.md Content Classification

## Contents

- [Stub files — delete as cleanup, no classification](#stub-files-delete-as-cleanup-no-classification)
- [Signs of Claude-specific content (any one hit → ask the user)](#signs-of-claude-specific-content-any-one-hit-ask-the-user)
- [GENERIC content (move to AGENTS.md)](#generic-content-move-to-agentsmd)
- [MIXED sections — splitting strategy](#mixed-sections-splitting-strategy)
- [Legacy locations — `./CLAUDE.md` and `./.claude/CLAUDE.md`](#legacy-locations-claudemd-and-claudeclaudemd)
- [Nested legacy files — `<dir>/CLAUDE.md` and `<dir>/.claude/CLAUDE.md`](#nested-legacy-files-dirclaudemd-and-dirclaudeclaudemd)
- [What about personal and user-level files?](#what-about-personal-and-user-level-files)
- [Verification heuristic for the proposed split](#verification-heuristic-for-the-proposed-split)
- [Sources](#sources)

omp loads one project context file per folder depth, and `AGENTS.md` comes before `CLAUDE.md` at one depth. A `CLAUDE.md` next to an `AGENTS.md` is ignored, and a `.claude/CLAUDE.md` in the session folder loads in place of the `AGENTS.md` of that folder. The migration moves the content of each legacy file into `AGENTS.md` at the same depth and deletes the legacy file:

- **GENERIC** → moves to `AGENTS.md`; for a nested file, to `<dir>/AGENTS.md`
- **CLAUDE-SPECIFIC** → the user decides, one section at a time with the omp `ask` tool: drop it, or keep it in the same `AGENTS.md` as the generic sections
- **MIXED** → propose a split by paragraph; each Claude-specific paragraph goes to the same question

The signs below find content to classify. They are never destinations: the migration writes only `AGENTS.md` files, and it writes no rules file and no file under `.claude/`. **No write or delete happens without explicit approval.** The skill never creates or rewrites a `CLAUDE.md`.

## Stub files — delete as cleanup, no classification

A legacy file that holds only `@AGENTS.md` or `@../AGENTS.md` (plus blank lines) is a stub from an earlier import workaround. It carries no content. Mark it `DELETE` (cleanup) in the action table and do not classify it.

In a non-stub file, a leading `@AGENTS.md` or `@../AGENTS.md` line is dropped, not moved; `AGENTS.md` loads on its own.

## Signs of Claude-specific content (any one hit → ask the user)

Path and folder references:
- `.claude/` (for example `.claude/skills/`, `.claude/agents/`, `.claude/rules/`, `.claude/settings.json`)
- `.claude-plugin/`
- `~/.claude/`
- `~/.claude/projects/`

Tool and feature references (Claude Code primitives):
- `subagent_type` / `subagents`
- `Plan Mode` / `EnterPlanMode` / `ExitPlanMode`
- `Skill tool` (the Claude Code Skill activation tool specifically)
- `Agent tool` (the Claude Code Agent dispatch tool specifically; "agent" in lowercase, or the OpenAI Agents SDK, is NOT this)
- `TaskCreate` / `TaskUpdate` / `TaskList` (Claude Code task tools)
- `Edit` / `Read` / `Write` / `Glob` / `Grep` with a Claude Code tool cue
- `Bash` with a permission-rule cue such as `Bash(...)`
- Hooks (`PreToolUse`, `PostToolUse`, `hooks` in Claude Code settings)
- Claude Code slash commands such as `/memory`, `/init`, `/agents`, `/permissions`

Environment variables:
- `CLAUDE_CODE_*` (any variable with this prefix)
- `SLASH_COMMAND_TOOL_CHAR_BUDGET`
- `CLAUDE_SESSION_ID`
- `CLAUDE_EFFORT`

Model identifiers:
- `claude-opus`, `claude-sonnet`, `claude-haiku` (and any specific model ID such as `claude-opus-4-7`)
- `Opus 4.X` / `Sonnet 4.X` / `Haiku 4.X` (in a Claude model tier context)

Vendor and product references:
- `Anthropic` (the company)
- `Claude Code` (the product name)
- `Claude API` (the API product)
- `RTK` / `Rust Token Killer` (a Claude Code proxy)

Auto memory:
- `auto memory` (the Claude Code feature, not generic memory talk)
- `MEMORY.md` in `~/.claude/projects/.../memory/`

Plugin marketplace:
- `.claude-plugin/marketplace.json`
- `claude plugin tag` (the CLI command)
- `plugins/<name>/.claude-plugin/`

## GENERIC content (move to AGENTS.md)

Sections in these categories with NO sign from the list above:

- **Repository purpose**: what the project is and why it exists
- **Environment**: language, runtime, package manager, install, dev, lint, test, and build commands
- **Repository layout**: folder tree, module organization
- **Engineering rules**: change-size limits, review process, test-before-finish, dependency policy
- **Code style**: naming, indentation, imports, file organization
- **Security**: secrets handling, destructive-operation gates, input-trust boundaries
- **Testing**: frameworks, conventions, coverage targets
- **Commit and PR conventions**: message format, branching, review process
- **Architecture decisions**: patterns that the codebase uses (database, auth, cache), as generic descriptions

## MIXED sections — splitting strategy

A section can hold generic content and Claude-specific content (typical case: a `## Security` section with generic principles plus a "use Plan Mode for destructive operations" rule):

1. Find the paragraphs with Claude-specific signs.
2. Propose: generic paragraphs → `AGENTS.md`; each Claude-specific paragraph → the drop-or-keep question of the skill.
3. If a paragraph mixes both, and removal of the Claude-specific clause changes its meaning (for example "Always run tests before commit. In Claude Code, use the Bash tool with the test command."), ask about the whole paragraph. Offer the generic principle as a separate `AGENTS.md` item.
4. Never delete content silently. Every section of the legacy file must reach its `AGENTS.md` destination, unless the user drops it.

## Legacy locations — `./CLAUDE.md` and `./.claude/CLAUDE.md`

A root legacy file can be at `./CLAUDE.md`, `./.claude/CLAUDE.md`, or both. omp keeps one project file per depth. Next to a root `AGENTS.md`, omp ignores `./CLAUDE.md`. When a session starts at the root, `./.claude/CLAUDE.md` loads in place of the root `AGENTS.md`. Thus:

- **Detect both.** Classify each one that exists. If both exist, classify the union, so that `AGENTS.md` gets no duplicate or contradicting rule.
- **Delete both** after their content is written to `AGENTS.md`. Delete last, never first.
- **Leave the rest of `.claude/` alone.** Skills, agents, settings, and other entries are report items; agent-first-setup cleans them up.

## Nested legacy files — `<dir>/CLAUDE.md` and `<dir>/.claude/CLAUDE.md`

A nested `<dir>/CLAUDE.md` next to `<dir>/AGENTS.md` is ignored by omp. Alone at its depth, it loads. A `<dir>/.claude/CLAUDE.md` loads only when a session starts in `<dir>`, and then in place of `<dir>/AGENTS.md`. Classify a nested file with the same signs, and keep its folder scope: its content goes to `<dir>/AGENTS.md`. The root routing row for that node belongs to `context-tree`; the skill reports that hand-off.

| Content | Destination | Write rule |
|---|---|---|
| Stub (`@AGENTS.md` / `@../AGENTS.md` only) | none | `DELETE` (cleanup) |
| GENERIC | `<dir>/AGENTS.md` | create if missing; else append a `## Migrated from <dir>/CLAUDE.md` section; never overwrite |
| CLAUDE-SPECIFIC, kept by the user | `<dir>/AGENTS.md` | same as GENERIC |
| CLAUDE-SPECIFIC, dropped by the user | none | named in the report |

For `<dir>/.claude/CLAUDE.md`, `<dir>` is the parent of `.claude/`. If `CLAUDE.md` and `.claude/CLAUDE.md` both exist in one folder, classify their union, as at the root. Classify files in different folders separately. Never move nested content to the root `AGENTS.md`: the root file loads in every session.

## What about personal and user-level files?

This skill migrates **project** context files only.

- `CLAUDE.local.md` (any depth) is personal and usually gitignored. omp does not load it. Report it and do not touch it. For personal context in omp, the user can add its name to the `contextFiles.extra` setting, or move the content to `~/.omp/agent/AGENTS.md`.
- `~/.claude/CLAUDE.md` and managed-policy files are out of scope. They often hold personal or organization settings that do not belong in the project repository.

## Verification heuristic for the proposed split

The primary check is **per-section presence** (the same contract as the Anti-Hallucination block of the skill): after the move, every `^#{1,3}` section of each non-stub legacy file, root and nested, must appear in its approved destination (`AGENTS.md` or `<dir>/AGENTS.md`). A missing section that the user did not drop means content loss: STOP and restore from the Step 5 backup. Pair it with a **net-shrink tripwire**: per legacy file, the moved lines must be at least the source lines minus the dropped import line and the lines of each section that the user dropped. A byte or line percentage floor is NOT the loss check: added headings hide a dropped section.

Secondary duplication tripwire only: if the moved lines exceed the source by more than ~15%, STOP and check whether a section landed twice (for example from the union of `CLAUDE.md` and `.claude/CLAUDE.md`). The tolerance covers new headings, blank-line changes, and small heading changes.

## Sources

- omp docs, `context-files.md`: the providers table (standalone `AGENTS.md` and `CLAUDE.md` at priority 10 by an ancestor walk; `.claude/CLAUDE.md` at priority 80 only in the session folder), the load order and shadowing rules (one project file per folder depth), `@` imports (up to five hops), and `contextFiles.extra` for extra file names. No default loader reads `CLAUDE.local.md`.
- omp docs, `skills.md` and `task-agent-discovery.md`: project skills in `.agents/skills/`, project agents in `.omp/agents/`, and `.claude/settings.json` as a project settings source. These facts are why the `.claude/` entries are report items for agent-first-setup.
- <https://code.claude.com/docs/en/settings>: the `.claude/` folder, plugin and marketplace, and tool and permission primitives behind the signs of Claude-specific content.
