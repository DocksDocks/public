# `/refactor` + `/solid` Merge — Design Spec

**Date:** 2026-04-16
**Status:** Approved for implementation-plan phase
**Scope:** Consolidate two overlapping kit commands into a single command with no loss of unique capability except one documented drop.

---

## Goals

1. **One command replaces two.** Delete `/solid`; merge its deep per-principle analysis into `/refactor` as a dedicated phase. Users stop having to choose between "structural audit" and "SOLID audit."
2. **No functionality regressions** (one intentional exception documented in §10). Every capability today in either command is preserved or strengthened in the merged command.
3. **Always-on full audit.** Non-interactive — no mode flags, no "ask if user wants deep analysis." Matches the philosophy locked in during the `/docs`+`/team` merge.
4. **Tighter permission surface.** Scoped `allowed-tools` frontmatter — drop broad `Bash(rm:*)`, `Bash(git:*)`, `Bash(npm:*)`, `Bash(pnpm:*)`, `Bash(yarn:*)`, `Bash(cargo:*)`, `Bash(pip:*)`. Permit only the specific subcommands the pipeline actually runs.
5. **Shell-avoidance constraint** applied to every phase — same pattern as the `/docs` merge. Use Glob / Grep / Read instead of `find` / `grep` / `cat` to eliminate compound-shell permission prompts during exploration.

## Non-goals

- Rewriting the Dead Code Scanner or the Duplication Scanner. Keep their scan categories intact (minus the category #5 SOLID sub-section in Duplication, which is replaced by the dedicated Phase 3 agent).
- Introducing new analysis categories beyond what `/refactor` or `/solid` already cover.
- Changing Plan Mode semantics, Phase Transition Protocol, or the Builder-Verifier pattern.

## Current state

### `/refactor` (572 lines, 7 phases)

| Phase | Purpose |
|-------|---------|
| 1 | Exploration — stack, monorepo, analysis tools, test infra, scope |
| 2 | Parallel: Dead Code Scanner \| Duplication & Reuse Scanner (includes lightweight SOLID as category #5, skips Liskov) |
| 3 | Planner — Tier 1 Quick Wins / Tier 2 Consolidation / Tier 3 Structural with 8 spec fields |
| 4 | Verifier — reference accuracy, safety, dependency ordering, anti-hallucination |
| 5 | Present + `ExitPlanMode` |
| 6 | Implementation — per-change test/revert loop |
| 7 | Post-Impl Verifier |

### `/solid` (445 lines, 8 phases)

| Phase | Purpose |
|-------|---------|
| 1 | Exploration — stack, abstractions, DI patterns, scope |
| 2 | Discovery — full component inventory (classes, interfaces, functions, dep graph, priority ordering) |
| 3 | Analyzer — deep per-principle evaluation (all 5 including Liskov), Critical/High/Medium/Low tiers |
| 4 | Planner — per-violation Pattern (Strategy/Factory/Extract Class/DI/Adapter), composition-over-inheritance rules |
| 5 | Verifier — violation-exists check, over-engineering gate |
| 6 | Present + `ExitPlanMode` |
| 7 | Implementation |
| 8 | Post-Impl Verifier — new-violation check, Final SOLID Score |

### Overlap

Exploration, Planner, Verifier, Implementation, Post-Impl Verifier are structurally near-identical. Divergence concentrates in the scanning pass: `/refactor` has two parallel scanners (dead code + duplication/reuse/lightweight-SOLID), `/solid` has two sequential scanners (Discovery + deep SOLID).

## Design — merged `/refactor` (8-phase pipeline)

```
Phase 1  Exploration        stack, tools, tests, monorepo, DI patterns, scope
Phase 2  Parallel scan      [Dead Code Scanner] | [Duplication Scanner]
                            (Duplication Scanner minus category #5 SOLID)
Phase 3  SOLID Analyzer     NEW — inventory + deep per-principle, all 5
                            including Liskov, skips files flagged SAFE for
                            deletion by Phase 2
Phase 4  Planner            3 input streams → Tier 1/2/3 plan with 9 spec fields
                            (adds Pattern field for SOLID/structural refactorings)
Phase 5  Verifier (pre)     reference accuracy, safety, over-engineering gate
                            for SOLID entries, anti-hallucination
Phase 6  Present + ExitPlanMode
Phase 7  Implementation     Edit + git rm + per-change test/revert loop
Phase 8  Post-Impl Verifier diff review, tests, no dangling refs, no new SOLID
                            violations, SOLID compliance delta in output
```

Each sequential phase writes its output to the plan file before the next agent launches. Phase Transition Protocol unchanged from current kit convention.

## Frontmatter + permission surface

```yaml
---
name: refactor
description: Use when auditing a codebase for structural issues — dead code, duplication, SOLID violations (all 5 principles including Liskov), missing abstractions, modernization candidates. Generates a tiered refactoring plan (quick wins → consolidation → structural) with per-change test strategy and revert triggers. Full-project scan by default; accepts a path argument to scope.
allowed-tools: >-
  Read Grep Glob Task WebFetch WebSearch Edit Write
  Bash(date) Bash(ls:*) Bash(find:*) Bash(wc:*) Bash(mkdir:*) Bash(rtk:*)
  Bash(git status) Bash(git log:*) Bash(git diff:*)
  Bash(git rm:*) Bash(git add:*) Bash(git restore:*)
  Bash(npx knip:*) Bash(npx depcheck:*) Bash(npx ts-prune:*) Bash(npx tsc:*) Bash(npx eslint:*)
  Bash(vulture:*) Bash(ruff:*) Bash(mypy:*)
  Bash(deadcode:*) Bash(cargo-udeps:*)
  Bash(npm test) Bash(npm run test:*) Bash(pnpm test) Bash(pnpm run test:*) Bash(yarn test)
  Bash(pytest:*) Bash(cargo test:*) Bash(go test:*)
---
```

**Differences vs. current `/refactor`:**

Dropped (too broad): `Bash(rm:*)`, `Bash(git:*)`, `Bash(npm:*)`, `Bash(pnpm:*)`, `Bash(yarn:*)`, `Bash(cargo:*)`, `Bash(pip:*)`.

Scoped in:
- `git rm:*` for dead-file deletion (staged, reversible via `git restore --staged`).
- `git add:*` for staging refactor edits.
- `git restore:*` for per-change revert on test failure.
- Test-runner subcommands only (`npm test`, `pnpm test`, `pnpm run test:*`, `pytest:*`, etc.) — not broad package-manager wildcards.
- Analysis-tool subcommands only (`npx knip:*`, `vulture:*`, `deadcode:*`, etc.).
- Linters (`ruff:*`, `npx eslint:*`) and type checkers (`mypy:*`, `npx tsc:*`) for Post-Impl verification.

**Unscoped `Edit` and `Write`:** `/refactor` legitimately touches any source file in the project. Plan Mode + the user-approved refactoring list in the plan file is the gate, not frontmatter path-scoping.

## Shell-avoidance constraint (every phase)

```
Use Claude Code native tools, not shell equivalents:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l` inside `$(...)`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes — each subcommand re-triggers permission prompts even when the allow-list would cover individual commands.

Bash is only for commands with no tool equivalent (`date`, `git log`, `git status`, `git diff`,
`git rm`, `git add`, `git restore`, `mkdir`, `rtk`, test runners, analysis tools, type checkers,
linters).
```

## Phase specifications

### Phase 1 — Exploration (update)

Preserved from current `/refactor`, plus one addition from `/solid`:

- **Dependency injection patterns** (new): detect constructor injection, DI containers, factory-function injection, service registries. Note any frameworks (NestJS, InversifyJS, Symfony DI, Spring) and their conventions. Output under **Existing Abstractions** alongside class hierarchies and interface definitions.

### Phase 2 — Parallel scan (changes)

**Dead Code Scanner:** unchanged.

**Duplication & Reuse Scanner:** remove category #5 (SOLID violations). Categories 1-4 and 6 retained:
1. Exact/near-duplicate code blocks
2. Function extraction candidates
3. Frontend component reuse
4. Import/module organization
6. Modernization candidates

Output format unchanged aside from the removal of the `## SOLID Violations` section.

### Phase 3 — SOLID Analyzer (new)

Single Task agent running sequentially after Phase 2.

**Context it receives:**
- Phase 1 Exploration output (stack, DI patterns, existing abstractions).
- Phase 2 Dead Code Scanner SAFE list — files slated for deletion. Analyzer must skip these files.
- Phase 2 Duplication Scanner full output (for cross-reference).

**Steps:**

1. **Component inventory** (absorbs `/solid` Phase 2 Discovery). Use Glob + Grep to catalog:
   - Classes and modules (service, repository, controller, factory classes)
   - Interfaces, type aliases, abstract classes, Python protocols
   - Standalone and factory functions
   - Import relationships + DI setup + service containers/registries
   - Exclude any file in the Dead Code Scanner's SAFE list

2. **Analysis priority ordering** (from `/solid` Phase 2): order components by complexity/importance before per-principle evaluation, so the most impactful components are analyzed first if context budget runs short.

3. **Per-principle evaluation** of each surviving component against all 5 principles:

   - **S (SRP)**: multiple unrelated responsibilities, >3 reasons to change, "and" in class/module names, god classes
   - **O (OCP)**: switch/if-else chains that must be modified for new variants; hardcoded type checks
   - **L (LSP)**: subclasses throwing unexpected exceptions; overridden methods breaking parent contracts; `instanceof` checks that gate behavior
   - **I (ISP)**: large interfaces forcing unused stubs (frontend: props with >10 optionals); "not supported" throws
   - **D (DIP)**: direct instantiation of dependencies in business logic (`new ConcreteClass()`); direct imports of concrete implementations instead of abstractions

4. **Monorepo cross-package check** (from current `/refactor` lightweight SOLID): cross-package coupling — backend importing frontend types, shared packages depending on app-specific code, cross-app imports that should go through a shared package.

5. **Pattern suggestion** for each violation: Strategy, Factory, Adapter, Extract Class, Split Interface, Dependency Injection, etc. Use context7 → WebFetch to verify framework-specific pattern APIs before recommending (same research requirement as current `/refactor` Planner).

**Output per violation:**
- `file:line`
- Principle (S/O/L/I/D)
- Evidence — concrete description with a short quote of offending code if useful
- Impact (high / medium / low)
- Suggested refactoring pattern
- Risk tier for Planner (low / medium / high)

**Constraints:**
- Shell-avoidance constraint applied.
- Every violation MUST include `file:line` and concrete evidence.
- Skip SAFE-flagged dead code (no analysis value for code about to be deleted).
- Context7 + WebFetch before suggesting pattern-based refactorings that touch framework APIs.

### Phase 4 — Planner (update)

**Adds one spec field** — `Pattern` (9 total per refactoring):
1. Priority tier (1 / 2 / 3)
2. Category: dead-code | duplicate | extraction | component-reuse | module-reorg | modernization | solid-violation
3. Files affected
4. What changes (before → after)
5. Risk (low / medium / high)
6. Test strategy
7. Revert trigger
8. Dependencies
9. **Pattern** (new): for `solid-violation` entries — Strategy / Factory / Extract Class / DI / Split Interface / Adapter / etc. Optional / N/A for other categories.

**Tier mapping for SOLID violations:**
- **Tier 2 (Consolidation)**: ISP splits, OCP → Strategy pattern (contained within one module, low-medium risk).
- **Tier 3 (Structural)**: SRP → Extract Class, DIP → Dependency Injection, LSP fixes (cross-file, higher risk).

**Strategy constraint** (from `/solid`): prefer composition over inheritance for L and I violations. State this in a `<constraint>` block inside the Planner task.

Tier 1 (Quick Wins) and non-SOLID Tier 2/3 entries unchanged from current `/refactor`.

### Phase 5 — Verifier (pre-impl, update)

Preserve current `/refactor` Verifier's four check groups: reference accuracy, safety verification, dependency ordering, completeness. Add one:

**Over-engineering check** (from `/solid` Phase 5): for every `solid-violation` Planner entry — is the proposed refactoring simpler than the problem it solves? Reject any refactoring whose complexity exceeds the violation's actual impact. Output under a new `## Over-Engineering Check` section.

Anti-hallucination checks unchanged.

### Phase 6 — Present + ExitPlanMode

Unchanged. Writes plan summary (refactorings by tier, impact estimate, skipped findings) to the plan file, calls `ExitPlanMode`.

### Phase 7 — Implementation (update)

Unchanged algorithm: baseline test run → per-refactoring loop (characterization tests if needed → apply change → test → lint → log APPLIED/REVERTED) → final test run.

**Changes vs. current `/refactor`:**
- File deletion uses `git rm` (not `rm`). Staged, reversible.
- Revert on test failure uses `git restore` (not `git checkout --`).
- All test-runner, linter, and type-checker invocations use the scoped subcommand permission rules from frontmatter (e.g., `npm test`, not arbitrary `npm:*`).

### Phase 8 — Post-Impl Verifier (update)

Current `/refactor` Post-Impl checks preserved. Add two from `/solid`:

**New SOLID violation check**: re-analyze every refactored file against the 5 principles. Did fixing one violation introduce another? Flag any new violations under `## New Violations Introduced`.

**SOLID compliance delta**: compare pre-impl violation count (from Phase 3 output) to post-impl violation count (from new analysis). Report as a summary line in Post-Impl output:

```
SOLID violations — before: 47 | after: 12 | resolved: 38 | new: 3
```

Anti-hallucination checks unchanged.

## Migration

1. **Delete** `ssot/.claude/commands/solid.md`.
2. **Delete** `~/.claude/commands/solid.md` (additive `sync.sh` merge does not propagate deletions; must remove directly).
3. **Rewrite** `ssot/.claude/commands/refactor.md` to the 8-phase structure described above, with the new frontmatter.
4. **Update** `ssot/CLAUDE.md` commands table (top of file):
   - Remove the `/solid` row.
   - Update the `/refactor` row pipeline cell to: `Exploration → [Dead Code Scanner | Duplication Scanner] → SOLID Analyzer → Planner → Verifier → Impl → Post-Impl Verifier`
   - Update the "Pattern" cell: `DAG + Builder-Verifier (sequential SOLID phase)`
5. **Run** `./sync.sh` (or `./sync.sh --force` if drift cleanup is needed for the deleted `/solid`).
6. **Validate** with `bash guard-commands.sh` and `bash score-commands.sh` from the repo root.
7. **Smoke test** in a fresh Claude Code session: run `/refactor` on a small scope and verify (a) zero `AskUserQuestion` prompts, (b) zero compound-shell permission prompts during exploration, (c) Phase 3 SOLID Analyzer fires with all 5 principles including Liskov.

## Out of scope / intentional functionality loss

**`/solid --principle=X src/`** is dropped. The merged `/refactor` always analyzes all 5 SOLID principles; no flag to scope to a single principle. Rationale: consistent with the "non-interactive full audit" philosophy locked in during the `/docs` merge. Workaround for users who want principle-focused attention: read only the relevant section of the Phase 3 output.

All other `/solid` capabilities are preserved — 7 gaps found during self-audit are patched in the design above (component inventory, analysis priority ordering, Pattern spec field, DI detection in Phase 1, over-engineering gate in Phase 5, new-violation check in Phase 8, SOLID compliance delta in Phase 8).

## Acceptance criteria

1. `/refactor` runs with zero `AskUserQuestion` prompts and no mode flags.
2. Phase 3 (SOLID Analyzer) fires on every invocation and evaluates all 5 SOLID principles including Liskov.
3. Phase 3 skips files that Phase 2's Dead Code Scanner flagged SAFE.
4. Frontmatter contains no `Bash(rm:*)`, no `Bash(git:*)` broad, no package-manager wildcards (`Bash(npm:*)`, `Bash(pnpm:*)`, etc.), no `Bash(cargo:*)`, no `Bash(pip:*)`.
5. Frontmatter contains `Bash(git rm:*)`, `Bash(git restore:*)`, and scoped test/analysis-tool subcommands.
6. Every phase includes the shell-avoidance `<constraint>` block.
7. Phase 4 Planner output includes a `Pattern` field populated for every `solid-violation` entry.
8. Phase 5 Verifier output includes an `## Over-Engineering Check` section for SOLID entries.
9. Phase 8 Post-Impl output includes a `SOLID compliance delta` summary line.
10. `/solid` is absent from both `ssot/.claude/commands/` and `~/.claude/commands/`.
11. `CLAUDE.md` commands table reflects the merged `/refactor` pipeline and has no `/solid` row.
12. `bash guard-commands.sh` and `bash score-commands.sh` both pass.
13. Smoke test: `/refactor` on a small scope produces a tiered plan covering dead code + duplication + SOLID, with zero compound-shell permission prompts during exploration.
