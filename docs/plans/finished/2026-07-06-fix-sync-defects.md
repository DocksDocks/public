---
title: Fix 12 code-level defects in lib/*.sh & SoT surfaced by the skills audit
goal: Tier and fix the sync-kit bugs (RTK hook wipe, unguarded cp, silent no-op target, missing .bak, --force no-op, rule-gate gaps) found by the 2026-07-06 audit.
status: finished
created: "2026-07-06T12:25:43-03:00"
updated: "2026-07-06T13:03:42-03:00"
started_at: "2026-07-06T12:41:11-03:00"
ship_commit: "a657d7617303fdd8fcba41d13b9f3aef48410ffe"
assignee: null
tags: [sync, bugfix, lib, security]
affected_paths:
  - lib/claude.sh
  - lib/codex.sh
  - lib/common.sh
  - lib/skills.sh
  - SoT/.codex/rules/docks.rules
  - SoT/.claude/settings.json
  - .claude/skills/plugin-bootstrap-context/SKILL.md
  - .claude/skills/codex-config-merge-context/references/rules-format.md
related_plans:
  - finished/2026-07-06-skills-agents-audit.md
review_status: passed
---

## Goal

Fix the 12 code-level defects the `skills-agents-audit` pattern scan surfaced (detail
in `finished/2026-07-06-skills-agents-audit.md` § "Code-level defects"). These are real
bugs in `lib/*.sh` / `SoT/`, distinct from the documentation fixes already shipped in
`3a2515a`. Tier by blast radius; apply Tier 1 first; **each Tier 2/3 fix and every open
design question needs explicit approval before it lands.**

No automated tests exist — the verification loop per fix is `./sync.sh --dry-run` plus a
targeted manual/`bash`/`jq` check, with a pre-declared revert trigger (`git restore`).

## Findings under investigation

| ID | Sev | Defect | Primary source |
|----|-----|--------|----------------|
| F1 | high | RTK hook self-wipe on fresh machine (sync_rtk last-pass `rtk init` clears PreToolUse) | `claude::sync_rtk` / `claude::sync` order |
| F2 | med | `sync_scripts` unguarded `cp` aborts sync at pass 1 under `set -e` | `claude::sync_scripts` |
| F3 | low | `select_target` latent silent no-op on an *unwired* target literal (the `--badtarget` CLI symptom does NOT reproduce) | `common::select_target` |
| F4 | med | `sync_agents_md` no `.bak` → clobbers hand-edited `~/.codex/AGENTS.md` | `codex::sync_agents_md` |
| F5 | med | `--force` near-no-op on Codex `config.toml` (log-only) + marketplace wholesale-copy | `codex::sync_config` / `sync_marketplace` |
| F6 | **high** | Systemic allow-prefix bypass: `rg --pre=CMD` / `sed 'e CMD'` RCE + reorder/suffix forms auto-approved past the gate | `docks.rules:94-101` |
| F7 | med | `tail -f` / `rg --pre` load-bearing escalations read as deletable | `docks.rules:94-96` |
| F8 | low | `codex::summary` counts disabled plugins in "N enabled" | `codex::summary` |
| F9 | low | `_warn_rtk_outdated` numeric sort mis-ranks `-rc` suffixes (advisory) | `claude::_warn_rtk_outdated` |
| F10 | low | stale `alert` log string (asset is `notification.mp3`) | `claude::sync_scripts` |
| F11 | low | 3 duplicate comment-strip impls must stay identical | `lib/skills.sh` |
| F12 | low/med | `rm -rf /` deny globs' trailing ` *` may miss the bare form | `SoT/.claude/settings.json:108-110` |

## Tiered fix plan

All 12 confirmed against current source (investigation `wf_cd365687-24f`, 12 agents).
Apply in tier order; each Tier 2/3 fix and every open question needs approval first.

### Tier 1 — ready to apply (local, low blast radius; recommended defaults inline)

| ID | Sev | Fix | File / fn | Revert trigger |
|----|-----|-----|-----------|----------------|
| F2 | med | Guard the `cp` of `statusline.sh`/`fetch-usage.sh` with `[[ -f src ]] && { cp…; chmod…; }` (mirror the `notification.mp3` guard). A missing SoT source soft-skips instead of aborting pass 1 under `set -e`. | `lib/claude.sh` `sync_scripts` | after fix a normal sync leaves `~/.claude/statusline.sh`/`fetch-usage.sh` missing or non-exec |
| F10 | low | Same fn: success-log `alert` → `notification` (asset was renamed). | `lib/claude.sh` `sync_scripts` | `bash -n` fails / no "Scripts synced" line |
| F4 | med | Write `~/.codex/AGENTS.md.bak` before overwrite (mirror `sync_config`/`sync_rules`/`sync_marketplace`), `[[ -f ]]`-guarded so a fresh machine writes no `.bak`. | `lib/codex.sh` `sync_agents_md` | `.bak` written on fresh machine, or deployed file ≠ SoT |
| F8 | low | Count enabled plugins via `codex::_enabled_plugin_ids \| grep -c .` (reuse the real parser) instead of `grep -c '^[plugins."'`, which counts `enabled=false` too. | `lib/codex.sh` `summary` | count wrong, or summary aborts under pipefail |
| F7 | med | Add a 3-line load-bearing `#` comment above the `tail -f`/`rg --pre` prompt rules so they aren't pruned as duplicates. (Recommend inline — `.rules` is execpolicy input, zero prompt cost, exempt from the no-inline-comment rule.) | `SoT/.codex/rules/docks.rules` | n/a (comment only) |
| F12 | low | Add exact-match `Bash(rm -rf /)`, `Bash(rm -rf ~)`, `Bash(rm -rf $HOME)` deny entries beside the ` *` globs. (Recommend minimal; broadening the glob list is brittle and auto-mode's classifier already gates the long tail.) | `SoT/.claude/settings.json` deny | over-deny of a legit scoped path |
| F3 | low | **Rec. Option A:** add a `*)` default arm that `err`+`exit 2` and move `TARGET_FILTER_SET=1` to after the case. Loud fail on a future mis-wired target instead of a silent no-op; matches `parse_args` line-59 convention. | `lib/common.sh` `select_target` | a valid `--claude/--codex/--agents` run errors/exits 2 |
| F9 | low | **Rec. Option A:** replace the `sort -t. -kNn` field sort with `sort -V` (correct parse for all `X.Y.Z`). The hand-installed-pre-release edge (Option B, semver `rc < final`) is deferred unless you want it. | `lib/claude.sh` `_warn_rtk_outdated` | a genuinely-older installed version stops warning |

### Tier 2 — needs a decision before applying

| ID | Sev | Decision | Recommendation |
|----|-----|----------|----------------|
| F1 | high | RTK hook-wipe restoration strategy (see Q1) | **Option B** — re-assert the SoT `PreToolUse` hook right after `rtk init --global` via a new `claude::_rtk_reassert_hook` (jq deep-merge, `.bak`); keeps pass order + the first-install-verbatim contract; single-file. |
| F11 | low | manifest-stripper whitespace semantics (see Q4, minor) | **Option A** — one shared `skills::_normalize_manifest` (all-whitespace, awk semantics) used by all 3 call sites; also fixes the latent tab/CRLF reconcile mis-detection. |

### Tier 3 / policy — explicit approval, no default picked

| ID | Sev | The call |
|----|-----|----------|
| F5 | med | Codex `--force` semantics (Q2) — the config and marketplace surfaces disagree today; pick one direction for both. |
| F6 | high | Is `docks.rules` a real security boundary or convenience-only? (Q3) — prefix rules structurally can't gate a reorderable/suffixable dangerous flag while a shorter `allow` prefix covers the base command. |

## Acceptance criteria

- Each applied fix passes its **revert trigger** check (above) and `./sync.sh --dry-run` output is unchanged except where a fix intentionally changes it.
- `bash -n lib/*.sh sync.sh` clean after every edit; `jq empty SoT/.claude/settings.json` and a TOML parse of `SoT/.codex/config.toml` still pass.
- F1: on a scratch `$HOME` (no `~/.claude/RTK.md`), **one** `./sync.sh --claude` leaves `jq -r '.hooks.PreToolUse[0].hooks[0].command' ~/.claude/settings.json` == `"rtk hook claude"` (today it is `[]`); other SoT hook blocks intact; 2nd run idempotent.
- F6: after the chosen option, a should-fail probe (`rg --pre=id foo` / `sed -n 'e id' f` under the Codex policy) is gated as intended.
- One commit per tier; Tier 1 lands first and is verified before Tier 2/3.

## Open questions

**Q1 — F1 RTK hook-wipe fix (Tier 2, high).** `rtk init --global` (last sync pass) clears `hooks.PreToolUse` that `sync_settings` wrote, so a fresh machine has no RTK hook until a 2nd sync.
- **B (recommended)** — re-assert the SoT `PreToolUse` hook after `rtk init` (new private helper, jq deep-merge, `.bak`). Keeps pass order + the "first install = SoT verbatim" contract; single-file.
- **A** — reorder `sync_rtk` before `sync_settings`. One-line move, but converts fresh-install from `_settings_install` (verbatim) to `_settings_merge`, changing the documented contract → effectively Tier 3.
- **C** — snapshot `~/.claude/settings.json`'s `.hooks.PreToolUse` before `rtk init`, restore after. Like B but restores what was deployed rather than re-reading SoT.

**Q2 — F5 Codex `--force` semantics (Tier 2/3, med).** Config `--force` is a log-only no-op (additive merge); marketplace `--force` wholesale-replaces (discards user entries) — they disagree.
- **Direction 1 (recommended, matches the documented contract + Claude)** — *preserve*: fix config's misleading "reconciled" log to say "additive merge", and make marketplace `--force` keep its additive jq merge (stop discarding user plugin entries). `--force` then honestly has no extra effect on Codex.
- **Direction 2** — *reset*: make config `--force` wholesale-replace to SoT (drop user-only keys/tables), keep marketplace wholesale. Diverges from Claude's `--force` and needs the AGENTS.md "user-only keys preserved" contract reworded.

**Q3 — F6 `docks.rules` security posture (Tier 3, high).** Prefix rules can't gate `rg --pre=CMD` / `sed 'e CMD'` (RCE) or reordered/suffixed mutating flags while a shorter `allow` covers the base command; the sandbox has `network_access=true`.
- **Option 1** — demote `sed -n` (and for full closure `rg`) `allow` → `prompt`. Robust — nothing about sed/rg is auto-approved — but adds a confirmation prompt to the two most-used read/search tools on every Codex turn.
- **Option 2** — keep the allows for velocity, add the one cleanly-gateable `sort -o`/`--output` prompt + a protective comment, and **explicitly accept** that `rg --pre=`/`sed 'e CMD'` RCE stays auto-approved, relying on the workspace-write sandbox + human diff review as the real boundary.

**Q4 — F11 stripper semantics (minor).** Recommend Option A (all-whitespace normalizer) — hardens against tab/CRLF; can't damage a valid `owner/repo` slug. Say the word if you'd rather keep space-only (Option B, zero behavior delta).

**Decided 2026-07-06:** Q1 → **B** (re-assert hook after init) · Q2 → **Direction 1** (preserve user content) · Q3 → **Option 1** (close the RCE: demote `sed -n`/`rg` allows to prompt) · Q4 → **A** (all-whitespace normalizer) · Tier-1 defaults (F3=A, F7=inline, F9=A `sort -V`, F12=exact-match) accepted. Implementing tier by tier: Tier 1 → verify → commit, then Tier 2, then Tier 3.

## Implementation (all tiers landed 2026-07-06)

One commit per tier, in tier order, each verified before the next.

| Tier | Commit | Findings | Files |
|------|--------|----------|-------|
| 1 | `a0cb5fe` | F2, F10, F4, F8, F7, F12, F3, F9 | `lib/claude.sh`, `lib/codex.sh`, `lib/common.sh`, `SoT/.codex/rules/docks.rules`, `SoT/.claude/settings.json` |
| 2 | `a9a070b` | F1, F11 | `lib/claude.sh`, `lib/skills.sh` |
| 3 | `a657d76` | F5, F6 | `lib/codex.sh`, `SoT/.codex/rules/docks.rules` + doc-follows-code: `plugin-bootstrap-context/SKILL.md`, `codex-config-merge-context/references/rules-format.md` |

Per-finding notes on the two policy fixes:
- **F1** — new `claude::_rtk_reassert_hook` re-applies the SoT `PreToolUse` block via `jq -s '.[1] * {hooks:{PreToolUse:.[0].hooks.PreToolUse}}'` immediately after `rtk init --global`, `.bak`-guarded; other hook blocks + rtk's own settings keys preserved. Pass order and the first-install-verbatim contract unchanged (Q1 → B).
- **F5** (Q2 → Direction 1, preserve) — `codex::sync_config` collapsed to one honest "merged (user-only keys/tables preserved)" log (the FORCE branch only mislabelled an additive merge as "reconciled"). `codex::sync_marketplace` runs the additive `reverse|unique_by(.name)` merge whenever a user file exists; `--force` no longer wholesale-copies over user personal-marketplace entries. Net: `--force` has no Codex-layer effect. Corrupt user `marketplace.json` now errs+skips under `--force` rather than being overwritten.
- **F6** (Q3 → Option 1, close the RCE) — `rg` and `sed -n` demoted `allow` → `prompt` in `docks.rules`; argv-prefix matching cannot gate `rg --pre=CMD` / `sed -n 'e CMD'` while a shorter `allow` prefix auto-approves the base command. Redundant `rg --pre` / `sed -n -i` / `sed -n --in-place` narrow rules dropped (subsumed).
- **F11** (Q4 → A) — one shared `skills::_normalize_manifest` (awk, all-whitespace) replaces the three divergent strippers.

### Verification evidence
- `bash -n lib/*.sh sync.sh` clean after every tier.
- `jq empty SoT/.claude/settings.json` valid; `SoT/.codex/config.toml` unchanged & parses.
- `./sync.sh --dry-run` exit 0 after each tier; `./sync.sh --codex --force --dry-run` exit 0 (F5).
- F1: `jq -s '.[1] * {hooks:{PreToolUse:.[0].hooks.PreToolUse}}'` restores the RTK `PreToolUse` command while preserving `SessionStart` + `rtkKey` (scratch-`$HOME` merge test).
- F3: bogus `--newtarget` now exits 2 (was silent exit 0).
- F8: enabled-plugin count 2 (was 3, which double-counted a disabled table).
- F6: `docks.rules` has `rg=prompt`, `sed -n=prompt`, no `allow` for either; all `prefix_rule` lines bracket/quote-balanced. No in-repo Codex rule-engine harness — verified structurally (this repo has no automated tests; plan's stated loop is `--dry-run` + manual checks).
- F11: normalizer strips a trailing tab the old `${slug// /}` kept; real `SoT/.agents/skills.txt` parses unchanged.

## Review

- **Goal met:** yes — all 12 findings (F1–F12) land as real code changes in the three tier commits and each addresses its defect; the 4 decided directions (Q1→B re-assert hook, Q2→Dir 1 preserve, Q3→Opt 1 demote rg/sed -n, Q4→A shared normalizer) are honored verbatim.
- **Regressions:** none — F1 jq merge preserves SessionStart/Stop/rtkKey (verified by simulated merge); F5 FORCE removal touched only the two intended functions (no other reset path lost); F6 leaves bare tail/grep/sort/head allow; docks.rules brackets 103/103, quotes even.
- **CI:** n/a (no project CI command) — stated loop `./sync.sh --dry-run` (exit 0), `bash -n lib/*.sh sync.sh` (clean), `jq empty SoT/.claude/settings.json` (valid), F3 bogus target exit 2 all green.
- **Follow-ups:** none — optional nit: two doc files changed are announced in the body but absent from frontmatter `affected_paths`.
- Filed by: plan-review on 2026-07-06T13:03:42-03:00
