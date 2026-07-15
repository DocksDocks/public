---
title: Adopt Effect v4 with the maintainer skill
goal: Migrate docks-kit to a coherent stable Effect v4 package set and install Kit Langton's pinned v4 skill for Claude Code and Codex without taking over user-owned skills.
status: planned
created: "2026-07-15T20:13:04-03:00"
updated: "2026-07-15T20:13:04-03:00"
started_at: null
assignee: null
review_author_company: openai
review_author_tool: codex
review_author_model: gpt-5.6-sol
review_author_effort: xhigh
review_waivers: []
tags:
  - effect
  - effect-v4
  - universal-skills
affected_paths:
  - package.json
  - bun.lock
  - SoT/.agents/skills.txt
  - cli/src/main.ts
  - cli/src/engine.ts
  - cli/src/services.ts
  - cli/src/commands/docs.ts
  - cli/src/commands/model.ts
  - cli/src/commands/models.ts
  - cli/src/commands/plugins.ts
  - cli/src/commands/skills.ts
  - cli/src/commands/status.ts
  - cli/src/commands/sync.ts
  - cli/src/commands/toolchain.ts
  - cli/src/commands/update.ts
  - cli/src/engine-native/skillsSync.ts
  - cli/src/generated/sotPayload.ts
  - cli/test/unit/services.test.ts
  - cli/test/unit/settings.test.ts
  - cli/test/unit/skillsSync.test.ts
  - cli/test/unit/payload.test.ts
  - cli/test/golden-dryrun.ts
  - cli/test/golden-mutation.ts
  - cli/test/goldens/dryrun.json
  - cli/test/goldens/mutation.json
  - README.md
  - AGENTS.md
  - CLAUDE.md
related_plans:
  - workflow-model-role-overrides
review_status: null
planned_at_commit: 2e9193f01f459a365efa16b7a135cb944a23cf71
execution_base_commit: null
---

## Goal

Move docks-kit's typed CLI from Effect 3 to a mutually compatible stable
Effect 4 package set, then make Kit Langton's upstream `effect` skill available
to both supported agents through the universal skill SoT. Preserve CLI behavior,
goldens, user-owned skill directories, and the repo's exact-version supply-chain
policy.

## Context & rationale

The repository currently pins `effect@3.21.4`, `@effect/cli@0.75.2`,
`@effect/platform@0.96.1`, `@effect/platform-bun@0.90.0`, and
`@effect/vitest@0.29.0`. On 2026-07-15, npm reports `effect@3.22.0` as stable
and `effect@4.0.0-beta.98` as beta; `@effect/cli` and `@effect/platform` expose
only v3-compatible stable tags. This plan is therefore stable-gated: do not
start the migration on a beta or on an incompatible mixed v3/v4 graph.

The requested skill is maintained by Kit Langton and explicitly targets
production Effect v4. Pin it to upstream commit
`30dee8607214c893dd89f6eee65c669ef3dce8c9` using the direct skill path:

```text
https://github.com/kitlangton/skills/tree/30dee8607214c893dd89f6eee65c669ef3dce8c9/skills/effect
```

The direct path is load-bearing. `skills@1.5.15` officially accepts a direct
path to a skill, and the current EngineNative derives the local skill name from
the source basename. Appending only `kitlangton/skills` would derive `skills`
instead of the actual `effect` directory, causing incorrect presence,
snapshot, and prune behavior. The commit-specific path yields `effect` and
prevents an unreviewed moving-main install.

Do not install the v4 skill while this checkout remains on Effect 3. The
existing `effect-kit@docks` plugin documents Effect 3.x; after migration the
project instructions must route this repository's v4 work to the maintainer
skill while leaving the namespaced setup/port skills installed. Plugin-internal
changes belong in the Docks repository and are not silently folded into this
plan.

## Environment & how-to-run

- Repository: `/home/vagrant/projects/public`, branch `main`.
- Package manager/runtime: Bun pinned by `SoT/toolchain.json`; dependencies are
  exact in `package.json` and `bun.lock`.
- Current upstream skill pin: commit
  `30dee8607214c893dd89f6eee65c669ef3dce8c9`, MIT license, `effect` skill tree
  SHA `a4976836fda99e454154db1e5e9ab350d75473ef`.
- Recheck package metadata before edits with `npm view <package> version
  dist-tags peerDependencies --json`; record the exact compatible versions in
  the dependency commit, never a tag or range.
- Use the pinned upstream `SKILL.md` and its `references/` during migration,
  but verify APIs against the installed v4 source/types and official Effect
  migration material before each edit.
- Install after package migration with `./docks-kit sync agents --dry-run`,
  then a real `./docks-kit sync agents` only in a disposable HOME for
  acceptance. Do not mutate the operator's real global skill store in tests.
- Focused checks: `bun run typecheck`, `bun run test:unit
  cli/test/unit/services.test.ts cli/test/unit/settings.test.ts
  cli/test/unit/skillsSync.test.ts cli/test/unit/payload.test.ts`, and
  workflow-filtered skill goldens added by this plan.
- Final gate: `bun run typecheck && bun run test:unit && bun run golden:dryrun
  && bun run golden:mutation`.

## Interfaces & data shapes

### Stable compatibility gate

A package matrix is eligible only when all of these are true:

```text
effect.version matches ^4\.[0-9]+\.[0-9]+$ (no prerelease)
@effect/cli peerDependencies.effect accepts that exact version
@effect/platform peerDependencies.effect accepts that exact version
@effect/platform-bun peers accept that exact effect/platform pair
@effect/vitest peerDependencies.effect accepts that exact version
```

If v4 consolidates or removes a companion package, replace that package only
when current official docs and the pinned skill identify the supported runtime,
CLI, or test entry point. Preserve the public CLI commands; dependency
consolidation is not permission to redesign the command surface.

### Universal skill source

Keep the line-oriented manifest. The new entry is exactly the immutable direct
path above. Extend the skill source parser with a closed representation:

```ts
interface UniversalSkillSource {
  readonly source: string
  readonly name: string
  readonly pinnedCommit?: string
  readonly skillPath?: string
}
```

For the new URL, `name = "effect"`, `pinnedCommit` is the 40-character commit,
and `skillPath = "skills/effect"`. Existing `owner/repo` entries retain their
current basename behavior. Reject malformed GitHub `tree/` URLs instead of
guessing a name.

Before claiming an already-present pinned skill as kit-managed, compare the
global skills lock entry's source/skill path with the manifest. A missing or
different provenance means user-owned or ambiguous: warn, leave the directory
and lock untouched, and exclude that source from the kit-managed snapshot.
After a fresh install, require the lock to identify the pinned source and
`skills/effect`; otherwise report failure and do not claim it for `--prune`.

## Steps

| # | Task | Files | Depends | Status | Done condition |
|---|---|---|---|---|---|
| 1 | Recheck official npm metadata and Effect v4 migration docs. Freeze one exact stable, peer-compatible package matrix and add characterization tests for every public CLI command before changing dependencies. If the gate is not satisfied, STOP with no tracked edits and keep this plan planned. | `package.json:22-38` (read); `bun.lock`; `cli/src/main.ts:1-130`; `cli/src/engine.ts:1-90`; `cli/src/services.ts:1-120`; `cli/src/commands/*.ts`; `cli/test/unit/services.test.ts`; `cli/test/unit/settings.test.ts`; existing golden suites | none | planned | npm metadata proves stable Effect 4 and compatible runtime/CLI/test peers; characterization tests pass on v3 and cover root options, every subcommand, exit codes, and stdout/stderr contracts. |
| 2 | Update exact dependencies and migrate the Effect-facing CLI/runtime code one boundary at a time using the pinned maintainer skill plus installed v4 types. Keep EngineNative and public command behavior stable; run focused tests after each boundary and revert the boundary on regression. | `package.json`; `bun.lock`; `cli/src/main.ts`; `cli/src/engine.ts`; `cli/src/services.ts`; `cli/src/commands/docs.ts`; `model.ts`; `models.ts`; `plugins.ts`; `skills.ts`; `status.ts`; `sync.ts`; `toolchain.ts`; `update.ts`; `cli/test/unit/services.test.ts`; `cli/test/unit/settings.test.ts` | 1 | planned | `bun install --frozen-lockfile`, typecheck, focused unit tests, and the existing public CLI/golden characterization all pass with one Effect 4 dependency graph and no v3 Effect package in `bun.lock`. |
| 3 | Add source-aware universal-skill parsing and ownership checks, then append the immutable direct `effect` path. Never adopt or prune a pre-existing mismatched `~/.agents/skills/effect`. Regenerate the embedded SoT. | `SoT/.agents/skills.txt:1-14`; `cli/src/engine-native/skillsSync.ts:18-380`; `cli/src/generated/sotPayload.ts`; `cli/test/unit/skillsSync.test.ts`; `cli/test/unit/payload.test.ts` | 2 | planned | Dry-run emits `npx skills@<pin> add <pinned-url> -g -y -a claude-code codex`; fresh disposable install produces canonical `~/.agents/skills/effect` plus the Claude symlink; conflicting provenance is preserved and excluded from `.kit-managed-skills`. |
| 4 | Update docs and project routing so v4 work in this checkout prefers Kit's `effect` skill, while the namespaced Docks setup/port skills remain available. Record the immutable source, update process, stable-only gate, and v3 near-miss. Refresh unit/golden fixtures. | `README.md`; `AGENTS.md`; `CLAUDE.md`; `cli/test/golden-dryrun.ts`; `cli/test/golden-mutation.ts`; `cli/test/goldens/dryrun.json`; `cli/test/goldens/mutation.json` | 2, 3 | planned | Docs never call the skill v3-compatible, never instruct a floating install, and explain how to bump the reviewed commit/tree; focused goldens detect source/name/provenance regressions. |
| 5 | Run the ordered acceptance inventory and one broad CI gate in a disposable HOME, inspect the lock/tree/symlinks, and record exact package/skill evidence before completion review. | all paths above; `docs/plans/active/effect-v4-maintainer-skill.md` receipts only | 1-4 | planned | A1-A7 and full CI pass; no real user HOME is mutated; the diff contains only the reviewed v4 migration, pinned skill source, ownership guard, tests, and docs. |

## Acceptance criteria

| ID | Command | Expected |
|---|---|---|
| A1 | `npm view effect version dist-tags --json \| jq -e '.version == .["dist-tags"].latest and (.version \| test("^4\\.[0-9]+\\.[0-9]+$"))'` | Exits 0; Effect 4 is stable rather than beta/snapshot. |
| A2 | `bun install --frozen-lockfile && bun pm ls --all \| rg 'effect@4' && ! bun pm ls --all \| rg 'effect@3'` | Exits 0; the lock installs exactly and output contains the reviewed v4 graph with no Effect 3 line. |
| A3 | `bun cli/scripts/generate-sot-payload.ts --check` | Exits 0; the pinned direct skill URL and all SoT bytes match the embedded payload. |
| A4 | `bun run test:unit cli/test/unit/services.test.ts cli/test/unit/settings.test.ts cli/test/unit/skillsSync.test.ts cli/test/unit/payload.test.ts` | Exits 0; v4 runtime/service behavior and source-aware skill ownership tests pass. |
| A5 | `tmp="$(mktemp -d)" && HOME="$tmp" AGENTS_DIR="$tmp/.agents" ./docks-kit sync agents --dry-run` | Exits 0; output names the exact commit-specific `/skills/effect` URL, the pinned `skills` CLI, and both supported agents without touching the operator HOME. |
| A6 | `tmp="$(mktemp -d)" && source="https://github.com/kitlangton/skills/tree/30dee8607214c893dd89f6eee65c669ef3dce8c9/skills/effect" && HOME="$tmp" AGENTS_DIR="$tmp/.agents" ./docks-kit sync agents && jq -e --arg source "$source" '.skills.effect.sourceUrl == $source and .skills.effect.skillPath == "skills/effect/SKILL.md"' "$tmp/.agents/.skill-lock.json" && test -f "$tmp/.agents/skills/effect/SKILL.md" && test "$(readlink "$tmp/.claude/skills/effect")" = "../../.agents/skills/effect"` | Exits 0; lock source/path are pinned, canonical content exists, and Claude points to the canonical universal copy. The mismatched pre-existing case is covered by A4. |
| A7 | `bun run typecheck && bun run test:unit && bun run golden:dryrun && bun run golden:mutation` | Exits 0 once; full CLI, generated-payload, dry-run, mutation, and argv contracts pass. |

## Out of scope / do-NOT-touch

- Do not start on an Effect 4 beta, snapshot, mixed peer graph, or mutable npm
  dist-tag; this kit is production configuration infrastructure.
- Do not port EngineNative's ordinary TypeScript modules to Effect merely
  because v4 is available; migrate only existing Effect boundaries.
- Do not redesign public commands, output channels, exit codes, model/workflow
  behavior, sync layers, or golden normalization.
- Do not edit the Docks plugin's `effect-kit` skills in this repository. If its
  v3 descriptions need a v4 release, file and execute that work in
  `DocksDocks/docks` as a separately reviewed plan.
- Do not install the upstream skill into the operator's real HOME during tests.
- Do not overwrite, relink, snapshot, or prune a pre-existing `effect` skill
  whose lock provenance differs or is absent.

## Known gotchas

- Effect v4 is currently beta and companion packages do not yet expose one
  coherent stable v4 matrix. A core-only upgrade would break `@effect/cli` and
  the platform/runtime seam.
- The upstream repository basename is `skills`, but the skill name is
  `effect`; the unqualified `kitlangton/skills` slug is wrong for current
  basename-based idempotence and pruning.
- `skills add --skill effect` is supported, but the immutable direct path is
  preferred because it selects the same skill and pins the reviewed commit in
  one source string.
- The global skills lock contains source/path provenance. Directory existence
  alone is insufficient evidence that an existing skill is kit-owned.
- `bun install` may update unrelated transitive formatting/order in `bun.lock`;
  inspect the dependency delta and reject a mixed v3/v4 graph.
- The pinned skill is v4-only. Installing it before the package migration would
  expose conflicting v3/v4 guidance in this checkout.
- `@effect/tsgo` currently describes v4 support as alpha. It is not required by
  this plan; add it only through a separately justified, exact-version change.

## Global constraints

- Effect gate: stable exact `4.x.y`, no beta/snapshot/prerelease.
- Package graph: every Effect companion peer must accept the same exact v4
  core; no Effect 3 package remains.
- Skill source: commit
  `30dee8607214c893dd89f6eee65c669ef3dce8c9`, tree
  `a4976836fda99e454154db1e5e9ab350d75473ef`, MIT license.
- Skill install: pinned `skills@1.5.15`, global, noninteractive, agents exactly
  `claude-code` and `codex`.
- Ownership: user-only or provenance-ambiguous `effect` paths are preserved and
  never added to the kit-managed prune snapshot.
- Verification: characterization before dependency edits, focused boundary
  tests during migration, one full CI gate before completion review.
- Supply chain: exact package versions and immutable upstream commit; no
  `@latest`, branch URL, streamed installer, or secret in SoT.

## STOP conditions

- STOP with no tracked migration edits if A1 is false or any required companion
  package lacks an officially supported stable v4 path.
- STOP and revert the current boundary if a public CLI characterization changes
  without an explicit requirement in this plan.
- STOP before skill installation if the pinned commit/tree or MIT license no
  longer matches the reviewed source inventory.
- STOP without touching the path if `~/.agents/skills/effect` exists but its
  lock source/path does not match the pinned manifest entry.
- STOP and file Docks-repo work if overlapping v3 `effect-kit` guidance cannot
  be unambiguously routed by installed Effect major from this repo's docs.

## Cold-handoff checklist

- [x] File manifest: every migration, skill, test, golden, and docs surface is
  named in frontmatter and the step table.
- [x] Environment & commands: npm metadata, Bun install, payload generation,
  focused tests, disposable HOME, and full CI commands are explicit.
- [x] Interface & data contracts: stable package gate, universal source type,
  direct URL/name mapping, lock provenance, and snapshot ownership are closed.
- [x] Executable acceptance: A1-A7 are ordered commands with binary expected
  outcomes; A6 defines the disposable real-install inspection.
- [x] Out of scope: beta adoption, EngineNative expansion, CLI redesign, Docks
  plugin edits, real-HOME mutation, and user-skill takeover are excluded.
- [x] Decision rationale: stable gating, direct pinned path, migration-before-
  install order, and provenance checks explain every non-obvious choice.
- [x] Known gotchas: current peer mismatch, basename mismatch, global lock,
  lockfile drift, v3/v4 conflict, and alpha tooling are recorded.
- [x] Global constraints: exact stable/pin/agent/ownership/test/supply-chain
  values are copied above.
- [x] No undefined terms / forward refs: package eligibility, manifest parsing,
  lock ownership, migration boundaries, and acceptance artifacts are defined.

## Self-review

Score: 95/100 · one local pass · caught: an initial “append kitlangton/skills”
idea would derive the wrong local name; installing before migration would expose
v4 guidance to a v3 checkout; directory-only idempotence could claim a
user-owned skill. The revision pins the direct `skills/effect` tree, gates on a
stable compatible package matrix, orders migration before install, and adds
lock-provenance ownership checks.

Independent draft review was not reattempted in this session because the host
already returned authoritative `platform_denied` results for both configured
reviewer companies before launch. No independent findings were produced. Keep
this plan planned until a permitted host completes the bounded X/S draft review
or the repository owner explicitly authorizes zero-review progression for this
specific plan.

## Review

(filled by plan-review on completion)

## Mistakes & Dead Ends

- None.

## Sources

- `package.json:22-38` and `bun.lock:8-46,274` — current exact Effect 3 package
  set and peer graph.
- `cli/src/main.ts:1-130`, `cli/src/engine.ts:1-90`,
  `cli/src/services.ts:1-120`, and `cli/src/commands/*.ts` — all existing Effect
  boundaries; EngineNative modules outside these imports are not migration
  targets.
- `SoT/.agents/skills.txt:1-14` — current line-oriented universal manifest has
  only `vercel-labs/agent-browser`.
- `cli/src/engine-native/skillsSync.ts:18-120,321-375` — current basename
  idempotence, pinned CLI argv, prune snapshot, and source-agnostic ownership
  behavior.
- `https://github.com/kitlangton/skills/tree/30dee8607214c893dd89f6eee65c669ef3dce8c9/skills/effect`
  — reviewed v4 skill source; `SKILL.md` blob
  `48f467431b823c37bf35c57c7ceca2c16313532f`, references tree
  `d3372ec9e26b31acd259585bd4071c2aa3f5ba61`.
- `https://github.com/kitlangton/skills/blob/main/LICENSE` — MIT license.
- `https://github.com/vercel-labs/skills/blob/main/README.md` — official CLI
  supports `--skill <name>` and direct repository paths.
- `https://github.com/Effect-TS/effect-smol/tree/main/migration` — upstream v4
  migration notes; current coverage is incomplete, so installed types remain
  authoritative.
- npm registry metadata captured 2026-07-15 — stable core is 3.22.0, v4 is
  `4.0.0-beta.98`, and current `@effect/cli`/`@effect/platform` stable peers
  still require Effect 3.

## Notes

- Upstream `SKILL.md` SHA-256 at the pinned commit:
  `66314e7e70c752f2c5b999123dea5fefc526841f48e9ec34c27615f01be2bfa1`.
- Upstream license SHA-256 at the pinned commit:
  `4994c24b5bbb85529407e8cd0211efcf819236899d2c911cbdb18c00f231273a`.
