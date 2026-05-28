---
title: Update kit docs for skills CLI v1.5 storage model and Codex reach
status: finished
created: 2026-05-14
updated: 2026-05-28
assignee: null
blockers: []
blocked_reason: null
blocked_since: null
ship_commit: b51a9b791922cb465a17d1cf83b531b591e98eae
---

# Update kit docs for skills CLI v1.5 storage model and Codex reach

## Context

The `skills` CLI (agentskills.io, `npx skills`) changed how single-agent
installs land. v1.5.7, invoked as `npx skills add <slug> -a claude-code`
(one agent — what the kit's `lib/skills.sh` did before this plan), copies
the skill directly into `~/.claude/skills/<name>` as a real directory and
skips the universal `~/.agents/skills/` canonical path entirely. The
broken `~/.claude/skills/find-skills` symlink on disk is a fossil of an
earlier layout.

`lib/skills.sh` was fixed in the 2026-05-14 session to match the new
reality (arg-order corrected, `SKILLS_DIR` retargeted, summary count
switched off `find`). But the kit's *documentation* still described the
old model in two places, and a real question went unanswered: with
`-a claude-code` copying only into `~/.claude/skills/`, do non-Claude
tools (Codex) still receive universal skills at all? The kit's entire
"universal-skill bootstrap" framing — and its two-tool (`claude-code` +
`codex`) support matrix — depends on the answer.

User-confirmed (2026-05-14 session): retarget the code now, defer the docs
fix + Codex-reach research to this plan rather than solving inline.

## Scope

Research is complete (see Notes). The universal `~/.agents/skills/`
canonical path still exists in v1.5.7 — it only materializes on a
*multi-agent* install. The kit's old single-agent `-a claude-code`
invocation triggered a copy-direct shortcut that skipped the canonical
path and left Codex uncovered. The fix, applied across the five spots
below:

- `lib/skills.sh` `skills::sync_universal` — widen the invocation from
  `-a claude-code` to `-a claude-code codex` (the kit's real support
  matrix: it ships both `SoT/.claude/` and `SoT/.codex/`). Applied to all
  three spots that name the agent — the real `npx skills add` call, the
  dry-run echo, and the warn/remediation message.
- `lib/skills.sh` — re-point `SKILLS_DIR` from `~/.claude/skills` back to
  `~/.agents/skills`, the canonical path under the widened invocation.
  The earlier retarget was correct only for the broken single-agent
  behaviour; comments and the `mkdir -p` target updated to match.
- Real-machine reconciliation — `~/.claude/skills/agent-browser` was a
  real copied dir (from the earlier `-a claude-code` install). Verified
  `npx skills add … -a claude-code codex` converts it cleanly to a
  symlink with no pre-remove needed (see Notes).
- `AGENTS.md` § Skills — rewrite the "Universal-skill bootstrap"
  paragraph: source-first invocation with `-a claude-code codex`, the
  universal-vs-symlinked agent split, canonical `~/.agents/skills/<name>`
  copy, `~/.claude/skills/<name>` symlink, Codex reading canonical natively.
- `SoT/.agents/skills.txt` — rewrite the header comment to the same
  corrected layout and invocation.

## Acceptance criteria

Tri-state: `[~]` = done + verified but uncommitted; flips to `[x]` on the
ship commit.

- [x] `lib/skills.sh` invokes `npx skills add <slug> -g -y -a claude-code codex`
      (source-first, both agents) in all three spots; `SKILLS_DIR` points
      at `~/.agents/skills`
- [x] After `./sync.sh --agents`: `~/.agents/skills/agent-browser/` is a
      real dir and `~/.claude/skills/agent-browser` is a symlink to it.
      Codex coverage is structural, not CLI-reported — the canonical skill
      lives at `~/.agents/skills/<name>/`, which OpenAI's Codex docs
      confirm Codex reads as a user-level skill source. (`npx skills ls`
      can't surface Codex here: it lists per-tool-dir presence, and Codex
      has no per-tool skills dir — it reads the canonical path directly.)
- [x] `./sync.sh --agents` is idempotent — a second run reports
      "Universal skills already in sync (1 present)" / "1 universal
      skill(s) installed", exit 0
- [x] `AGENTS.md` § Skills and `SoT/.agents/skills.txt` describe the
      verified v1.5.7 layout — corrected invocation, canonical
      `~/.agents/skills/`, universal-vs-symlinked split — with no stale
      arg-order or "copies into ~/.claude/skills" claims

## Out of scope

- The arg-order, `mkdir -p` guard, and summary-tally fixes already landed
  in the 2026-05-14 session — not re-litigated here. (The `SKILLS_DIR`
  retarget from that session IS revisited: research changed what the
  correct target is.)
- Reworking the kit's universal-skill *strategy* (switching off the
  `skills` CLI, vendoring skills directly) — out of scope.
- Going broader than `-a claude-code codex` (e.g. `-a '*'`) — rejected by
  research: it installs into every AI tool on the machine (~50 agents),
  violating the kit's "only touch tools the kit supports" principle.
- `docks` plugin skills — they ship from the plugin repo, not this kit,
  and are unaffected by the universal-skill bootstrap path.
- Cleaning up the dead `~/.claude/skills/find-skills` symlink as kit
  behavior — noted as a finding, but auto-removing CLI fossils is its
  own decision.

## Blockers

None.

## Notes

- Triggering code fix (`lib/skills.sh`, 2026-05-14, uncommitted at plan
  creation — find it via `git log lib/skills.sh`): `skills add` arg-order
  corrected because the CLI's `-a/--agent` flag is variadic
  (`skills add <src> --agent claude-code cursor` is valid), so a
  source-after-flags invocation made `--agent` swallow the slug;
  `SKILLS_DIR` retargeted `~/.agents/skills` → `~/.claude/skills`;
  `mkdir -p "$SKILLS_DIR"` guard added (dry-run-guarded); summary count
  switched from `find "$SKILLS_DIR"` to `skills::sync_universal`'s own
  `added + already` tally (a bare `find` over `~/.claude/skills/` would
  also count user-installed, non-kit skills). This plan's `SKILLS_DIR`
  bullet reverts that one retarget — see the research findings for why.
- Evidence the storage model changed (observed 2026-05-14): `skills` CLI
  reports v1.5.7; before this plan's fix, `npx skills ls -g --json`
  listed every skill — kit and user — under `~/.claude/skills/<name>` as
  a real directory, and `~/.agents/skills/` did not exist.
- **Research findings (2026-05-14, skills CLI v1.5.7, isolated temp-HOME
  installs + vercel-labs/skills README):** the universal
  `~/.agents/skills/` canonical path still exists — it only materializes
  on a *multi-agent* install. Four behaviours observed:
  - `-a claude-code` (old kit invocation) → copy-direct to
    `~/.claude/skills/<name>` as a real dir; no `~/.agents/skills/`;
    Codex gets nothing.
  - `-a '*'` → canonical `~/.agents/skills/<name>`; the CLI splits its
    ~50 known agents into "universal" (Codex, Cursor, Cline, Amp, … —
    read `~/.agents/skills/` natively) and "symlinked" (Claude Code,
    Aider, … — get a per-tool symlink back to canonical).
  - `-a claude-code codex` (the fix) → canonical `~/.agents/skills/<name>`
    + `~/.claude/skills/<name>` symlink; CLI output reads
    `universal: Codex` / `symlinked: Claude Code`; `~/.codex/` stays
    empty (Codex reads the canonical path natively). Matches the kit's
    real support matrix.
  - no `-a` flag (just `-g -y`) → auto-detects agents; lands at canonical
    `~/.agents/skills/<name>` + `~/.claude/skills/<name>` symlink, and
    Codex (a "universal" agent) is covered for free. But the CLI also
    creates symlink dirs for other auto-detected symlink-type agents
    (Devin, Goose surfaced unprompted in a stubbed temp-HOME run) — too
    broad and non-deterministic for the kit.
- **Codex skill discovery — confirmed via OpenAI's official Codex docs
  (2026-05-14):** Codex reads `$HOME/.agents/skills` as a user-level
  skill source — exactly the canonical path the `-a claude-code codex`
  invocation writes. Naming `codex` as the second agent is therefore
  sufficient; no `~/.codex/skills/` copy or symlink is needed.
  `~/.codex/skills/.system/` exists on this machine — that is Codex's
  *built-in bundled* skills directory, a separate namespace from the
  user-level `$HOME/.agents/skills` source; the kit does not write there.
- Mechanism decision (2026-05-14, user-confirmed): cover Codex via the
  explicit two-agent form `-a claude-code codex`, not by dropping `-a`
  for auto-detect. Both reach Codex; the explicit form keeps the
  deterministic, narrow scope the kit's AGENTS.md mandates ("only touch
  tools the kit supports") and avoids the auto-detect spray into Devin /
  Goose / whatever else is on the machine. The kit's AGENTS.md
  "universal path / Codex reads natively / Claude Code symlink"
  description was never wrong about *intent* — the old single-agent
  `-a claude-code` invocation just never earned it.
- Reconciliation finding (2026-05-14): on a machine where
  `~/.claude/skills/agent-browser` was already a real copied dir from the
  old `-a claude-code` install, re-running with `-a claude-code codex`
  converts it cleanly — the CLI replaces the real dir with a symlink to
  the new canonical `~/.agents/skills/agent-browser/` and needs no
  `npx skills remove` / `rm -rf` pre-step. `./sync.sh --agents` therefore
  self-heals the drift; no special migration code in `lib/skills.sh`.
- assignee left `null` (matches the three finished plans); plan-manager
  picks or asks. This plan's work is functionally complete and verified;
  it stays in `ongoing/` until the changes are committed (`ship_commit`
  needs a SHA on `main`), then moves to `finished/`.
- Related: `docs/plans/finished/2026-05-11-sync-multi-tool-refactor.md`
  established `lib/skills.sh`; this plan reconciles its docs with CLI drift.
