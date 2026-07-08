---
title: docks-kit CLI — typed front-end, tool-scoped flags, toolchain floors
goal: Replace sync.sh with a self-documenting Effect-TS CLI over the bash engine, with renamed tool-scoped flags, model catalog, and verified-version toolchain floors
status: ongoing
created: "2026-07-08T13:00:00-03:00"
updated: "2026-07-08T14:55:00-03:00"
started_at: "2026-07-08T13:00:00-03:00"
assignee: null
tags: [cli, engine, toolchain, packaging]
affected_paths:
  - lib/
  - cli/
  - SoT/models.json
  - SoT/toolchain.json
  - docks-kit
  - install.sh
  - .github/workflows/release-cli.yml
  - README.md
related_plans: []
review_status: null
---

## Goal

One coherent CLI (`./docks-kit`) managing both SoTs, plugins, skills, models,
and the external toolchain — self-documenting enough that a fresh agent learns
the kit from `docks-kit docs` alone. Clean break from `sync.sh` and its opaque
flags (`--680k`, `--force`). Full design + rationale: the approved plan lives
at `~/.claude/plans/dazzling-hatching-lagoon.md` (session-local); this file is
the in-repo tracker.

## Steps

| # | Task | Depends | Status |
|---|------|---------|--------|
| 1 | Engine flag taxonomy (tool-scoped, positional targets, rename hints) + SoT/models.json + claude/codex model deploy-time modifiers + codex awk extraction | — | done (3f34e2f) |
| 2 | SoT/toolchain.json + lib/toolchain.sh (verified-version gate) + rtk/bun/effect-solutions/agent-browser rewiring + RTK-first reorder | 1 | done (f8760b6) |
| 3 | Effect-TS CLI (cli/, 8 commands, 9 docs topics) + ./docks-kit launcher + lib/engine.sh + delete sync.sh | 1,2 | done (ae8b90f) |
| 4 | Packaging: build-binaries.sh, install.sh, release-cli.yml, npm layout | 3 | done (15fd69f) |
| 5 | Docs sweep: README.md, CLAUDE.md/AGENTS.md reference rewrite, skills + wrapper agents, toolchain-context skill, CHANGELOG | 3 | done (9468a69) |
| 6 | SoT model stance (model opus + advisorModel fable + effortLevel xhigh in SoT/.claude/settings.json — user corrected: SoT, not a local pin) + end-to-end verification matrix | 5 | done (4a00f27 + this file's commit) |

## Acceptance criteria

- `grep -rn "sync\.sh" CLAUDE.md AGENTS.md README.md .claude/skills/ .claude/agents/` → zero rows (CHANGELOG/finished plans exempt)
- `bash -n` + `bunx tsc --noEmit -p cli` clean
- `./docks-kit sync --dry-run` step list ≡ pre-refactor `./sync.sh --dry-run` capture (verified byte-identical at step 3)
- Old flags exit 2 with rename hints; `--claude-model=bogus` exits 2 pre-mutation; bare `--claude-model` prints the catalog
- Round-trips: `model claude <value>` → set → flag-less sync reverts to the SoT value (verified when SoT was `best`; SoT is `opus` since 4a00f27); codex mirror (model line exactly once, tables untouched)
- Toolchain gate branches verified (TTY prompt path excepted — needs interactive run); effect-solutions self-upgrade fired live (unknown → 0.5.3)
- Fresh session in this repo shows Opus main + fable advisor — **user-side check, pending** (deploy done; requires a new interactive session)

## Open questions

- (resolved 2026-07-08) ~~npm publish needs an `NPM_TOKEN` repo secret~~ —
  switched to tokenless OIDC trusted publishing; remaining one-time user
  steps: manual first `npm publish` (new packages can't pre-register a
  trusted publisher), then configure the trusted publisher on npmjs.com
  (repo DocksDocks/public, workflow release-cli.yml). Name `docks-kit` is
  free on npm (404 checked 2026-07-08)
- (resolved 2026-07-08) ~~LICENSE file absent~~ — MIT LICENSE added
- Windows support moved to its own follow-up plan: `windows-support`

## Notes

- Effect v3 stable chosen over v4 beta: @effect/cli@0.75.2 peer-depends on
  effect ^3.21.2; no v4-compatible CLI release exists (checked 2026-07-08)
- RTK installer supports exact-version pinning via `RTK_VERSION=vX.Y.Z`
  (verified in upstream install.sh) — enables the non-TTY pinned-verified
  fallback in the toolchain gate
- Follow-up candidates (not this plan): TS-native engine port for Windows
  (EngineNative behind the cli/src/engine.ts seam), `toolchain check --json`,
  a toolchain wrapper agent
- Phase-6 verification run (2026-07-08): grep gates clean (sync.sh/old-flag
  refs only in CHANGELOG + finished plans); `bash -n` all shell + shellcheck
  clean (SC2088 excluded — intentional `~/` display strings); `bunx tsc
  --noEmit -p cli` exit 0; `./docks-kit sync --dry-run` exit 0; real
  `./docks-kit sync claude` deployed SoT → `~/.claude/settings.json` shows
  model=opus, advisorModel=fable, effortLevel=xhigh; `docks-kit status`
  reports zero drift on all four tracked keys and toolchain all-ok (ffplay
  missing — check-only; notification sound needs `sudo apt install ffmpeg`)
- Compact-window decision (user, 2026-07-08): keep 468000 on Opus-main — no
  350K revert; CLAUDE.md updated accordingly
- Post-completion review round (2026-07-08): self-review found + fixed the
  errexit abort on failed toolchain bootstrap (f21a4d3); a gpt-5.5
  session-relay review of 6b1b86f..HEAD found 6 more (all confirmed, fixed
  in 3ec16d7): --skip-rtk strip clobbered by the RTK-first reorder,
  unknown-latest installs bypassing the verified pin, secrets-in-if in the
  release workflow, launcher self-heal suppressed by partial node_modules,
  CLI parser contract gaps (legacy hints / bare model flag / repeatable
  --claude-plugin), stale cli/docs/models.md model stance

## Review

(filled by plan-review on completion)
