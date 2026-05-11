---
title: Audit `public` repo optimizations for Opus 4.7
status: ongoing
created: 2026-05-06
updated: 2026-05-11
assignee: null
blockers: []
blocked_reason: null
blocked_since: null
ship_commit: null
---

# Audit `public` repo optimizations for Opus 4.7

**Scope:** the `public` repo owns the consumer-facing pieces — `ssot/.claude/settings.json`, hooks (`ssot/.claude/hooks/*.sh`), status line scripts, `sync.sh`, and the global `ssot/.claude/CLAUDE.md` (synced to `~/.claude/CLAUDE.md`). Plugin-internal optimizations — per-agent frontmatter, command bodies, validators, agentskills.io structural compliance — live in `docs/optimization-audit-may-2026.md` in the [docks plugin repo](https://github.com/DocksDocks/docks).

## TL;DR

- **Three high-confidence wins for `public`:** (1) enable `CLAUDE_CODE_FORK_SUBAGENT=1` so children 2-N of parallel-scanner fan-outs inherit the parent's prompt-cache prefix (~10× input-token reduction per Anthropic v2.1.117 patch notes — but only if docks-side agents opt in via `context: fork`); (2) migrate the `SubagentStop` file:line validator from a bash regex to a `prompt` or `agent` hook for semantic verification of citations; (3) add the **Opus 4.7 literalism rule** as a new heuristic in `ssot/.claude/CLAUDE.md` — Anthropic flagged this as the single biggest behavioral change in 4.7.
- **Effort level: keeping `CLAUDE_CODE_EFFORT_LEVEL=max` is intentional kit policy.** The original audit recommended dropping the default to `xhigh` per Anthropic's "diminishing returns / overthinking" guidance; this kit explicitly trades the marginal token cost for a higher ceiling on every Opus orchestrator turn. The recommendation is **rejected for this repo**. The narrower case for per-agent overrides on Sonnet-tier subagents (where `max` can be wasteful inheritance) belongs in the docks doc, not here.
- **Defer to measurement:** 400K vs 200K vs 1M compact window. Anthropic's CPO published only a 15% reduction in compaction events from 1M; community evidence (Sikkema, Aider, JetBrains, NoLiMa) argues 200K + aggressive compaction often beats 1M on code work. Current 400K cap is a defensible middle ground; A/B test on a /refactor baseline before flipping.

---

## Tasks

Top-10 actionable items derived from §1 below. Per `docs/plans/AGENTS.md`: flip `[ ]` → `[x]` in the same commit that lands the change; bump `updated` in the frontmatter on every edit.

- [x] **(HIGH)** Enable `CLAUDE_CODE_FORK_SUBAGENT=1` in `ssot/.claude/settings.json` (§2.2). Requires docks-side `context: fork` opt-in to actually benefit.
- [x] **(MED)** Migrate `SubagentStop` validator from bash regex to `prompt` or `agent` hook (§3.1).
- [x] **(MED)** Add `PostToolUseFailure` hook to inject failure context on bash errors (§3.2).
- [x] **(HIGH)** Add Opus 4.7 literalism heuristic to `ssot/.claude/CLAUDE.md` as the 9th distilled rule (§4.1 #1).
- [ ] ~~**(HIGH)** Verify subagent prompt-cache behavior — instrument `cache_read_input_tokens` / `cache_creation_input_tokens` per the §1 measurement note.~~ **Deferred:** runtime measurement task; needs a real `/docks:refactor` parallel-scanner fan-out + JSONL inspection. Re-evaluate after docks-side `context: fork` opt-in lands so children 2-N actually exercise the cache-prefix path.
- [x] **(MED)** Bump `CLAUDE_CODE_MAX_OUTPUT_TOKENS` from 64000 to 96000 (§2.5).
- [ ] ~~**(MED)** A/B measure 400K vs 200K vs 1M compact window on a `/docks:refactor` baseline (§2.3).~~ **Deferred:** needs measurement scaffolding (the prior `tests/baseline/` was removed as stale); requires 3 sequential `/docks:refactor` runs on a fixed fixture with quality scoring. Out of scope for this round of plan execution.
- [x] **(HIGH)** Add cache-invariance heuristic to `ssot/.claude/CLAUDE.md` (§4.1 #3).
- [x] **(MED)** Add proactive-compaction heuristic to `ssot/.claude/CLAUDE.md` (§4.1 #5).
- [ ] ~~**(MED)** Document `--thinking-display summarized` shell alias in `ssot/.claude/CLAUDE.md` (§2.4).~~ **Reverted (wrong target):** the alias / flag is already documented in `public/CLAUDE.md` § Open Concerns. `ssot/.claude/CLAUDE.md` ships into every session's prompt context, so per-bug workarounds don't belong there — they'd burn prompt tokens every session for a fix that lives in shell profile or kit setup docs. Task as originally framed was misdesigned.

---

## Section 1 — Top recommendations (public-scoped)

Confidence: **HIGH** = multiple independent sources + empirical data; **MED** = one strong source or strong logical argument; **LOW** = speculative, pilot only.

| # | Recommendation | Confidence | Effort | Expected Impact |
|---|---|---|---|---|
| 1 | `CLAUDE_CODE_FORK_SUBAGENT=1` in `ssot/.claude/settings.json`. v2.1.117 enabled fork on external builds; children 2-N inherit prompt-cache prefix. | HIGH | trivial | ~10× input-token cut on parallel-scanner children (per Anthropic patch notes); requires docks-side agents to opt in via `context: fork`. |
| 2 | Migrate `SubagentStop` validator from regex to `prompt` or `agent` hook (event types added 2026). | MED | moderate | Eliminates whitelist drift; reduces false-block rate on semantically-valid outputs lacking literal `path:line`. |
| 3 | Add `PostToolUseFailure` hook (event added 2026) to inject failure context on bash errors. | MED | trivial | Better self-recovery on transient failures during long Phase-4/5 sessions on `/docks:refactor` and `/docks:security`. |
| 4 | Add **Opus 4.7 literalism rule** to `ssot/.claude/CLAUDE.md` as a new heuristic alongside the 8 distilled ones. | HIGH | trivial | Improves first-shot quality on every phase; Anthropic 4.7 release notes flag this as the dominant behavioral change. |
| 5 | Verify subagent prompt-caching is live. Per anthropics/claude-code issue #29966, Agent-SDK subagents had `enablePromptCaching: false` hardcoded. Instrument `cache_read_input_tokens` / `cache_creation_input_tokens`. | HIGH | moderate | If broken, fixing could cut subagent costs ~5×. The kit's reported 94% main-agent cache-hit rate suggests orchestrator is fine; parallel scanners may not be. |
| 6 | Bump `CLAUDE_CODE_MAX_OUTPUT_TOKENS` from 64000 to 96000. | MED | trivial | Anthropic recommends a higher cap when running `max` effort on 4.7's new tokenizer (1.0×–1.35× more tokens than 4.6); current 64K can truncate verbose synthesis outputs. |
| 7 | A/B measure 400K vs 200K vs 1M compact window on a `/docks:refactor` fixed-fixture run. | MED | trivial config flip | Either confirms 400K is the sweet spot, or unlocks ~30% session-quality lift on long phases. Workload-specific. |
| 8 | Add a **cache-invariance heuristic** ("do not insert timestamps, mutable state, or rotating tool definitions into the cached prefix; put dynamic context in `<system-reminder>` tags inside user messages"). | HIGH | trivial | Protects the 94% cache-hit rate the kit already achieves. |
| 9 | Add a **proactive-compaction heuristic** ("`/compact` at 50–60% beats waiting for autocompact; the model is at its least intelligent when compaction fires due to context rot"). | MED | trivial | Reinforces the existing `## Session Management` table in `public/CLAUDE.md`; promotes the rule from prose to enforceable heuristic. |
| 10 | Document the `--thinking-display summarized` workaround as a shell alias in `ssot/.claude/CLAUDE.md` instead of leaving it only in `public/CLAUDE.md` § Open Concerns. | MED | trivial | Surfaces the workaround at session start so contributors don't re-debug; alias persists across machines after sync. |

---

## Section 2 — `ssot/.claude/settings.json` Specific Changes

### 2.1 Effort level — KEEP `max` (no change)

Current: `CLAUDE_CODE_EFFORT_LEVEL=max`. **Decision: keep.**

The original audit recommended dropping to `xhigh` per Anthropic's post-launch best-practices guide ("max shows diminishing returns and is more prone to overthinking"), citing Hex's CTO measurement that "low-effort Opus 4.7 ≈ medium-effort Opus 4.6" and DataCamp's report of `xhigh` truncation when `max_tokens` was insufficient. Claude Code's automatic default is now `xhigh` (v2.1.117).

This kit accepts the marginal cost of `max` for two reasons:

1. The token-efficiency strategy targets Sonnet phases via per-agent frontmatter in the docks plugin (see `agent_optimization_docks.md` §A.1), not the global default.
2. The orchestrator turn — single Opus 4.7 main agent — is exactly the "intelligence-sensitive" use case Anthropic's guide flags as appropriate for `max`.

**Cross-reference:** the docks doc still tracks the per-agent `effort: xhigh` override on Sonnet-tier subagents that don't benefit from `max` (where parent inheritance currently wastes tokens). That's a plugin-side decision and does not require a change here.

### 2.2 Fork subagents — `CLAUDE_CODE_FORK_SUBAGENT=1` (HIGH / trivial / medium risk on first launch)

Add to the `env` block:

```json
"CLAUDE_CODE_FORK_SUBAGENT": "1"
```

Per anthropics/claude-code v2.1.117 changelog, this enables the dead-code-eliminated fork path on external builds. Mejba Ahmed's hands-on report and Build-This-Now's reverse-engineering article confirm working behavior.

**Caveats:**
- Issue #47350: `context: fork` skills can degrade output quality when paired with non-default models on Windows. Test on Linux/macOS first.
- Fork only fires when `subagent_type` is omitted in the Agent tool call (Build-This-Now finding); named-agent fan-outs may not trigger it. Combine with the policy-island pattern (`allowed_tools` at agent level) for predictable execution.
- Forks cannot spawn further forks (documented).

This env var on its own is a no-op without docks-side agent support. The plugin needs to add `context: fork` to the agents that should benefit (see `agent_optimization_docks.md` §A.3).

### 2.3 1M context — re-evaluate via measurement (MED / trivial config flip / low risk)

Current: 1M context (default), `CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000`. The 400K cap fires compaction at ~95% (~380K).

Run a `/docks:refactor` baseline three ways on a fixed fixture project:
- (a) current 400K cap on 1M context;
- (b) 1M context with proactive `/compact` at 50–60% (Thariq Shihipar's April 15, 2026 guidance);
- (c) `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` + `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=70` (200K + aggressive compaction).

**Why MED, not HIGH:** Anthropic's CPO Jon Bell published a 15% reduction in compaction events with 1M (real production data), and the kit already runs heavy parallel scanners that benefit from lots of code in main context. Albert Sikkema, Aider's Paul Gauthier, Amp/Dan Mac, and the NoLiMa benchmark all argue smaller-is-better; Anthropic's data argues otherwise. Workload-specific.

### 2.4 `showThinkingSummaries` — workaround already documented; promote to alias (HIGH / trivial)

`public/CLAUDE.md` § Open Concerns already documents the `claude --thinking-display summarized` workaround for the Opus 4.7 thinking-summary bug (issues #49268, #49708, #48065 — all OPEN as of 2026-05-06).

**Suggested addition:** mention the shell alias in `ssot/.claude/CLAUDE.md` so it surfaces at session start rather than only being discoverable when contributors hit the bug:

```bash
# add to ~/.bashrc or ~/.zshrc (kit cannot manage shell profile from sync)
alias claude='claude --thinking-display summarized'
```

When the issues close, remove the alias and the Open Concerns entry in the same commit.

### 2.5 Tokenizer headroom — bump `CLAUDE_CODE_MAX_OUTPUT_TOKENS` (MED / trivial)

Current: `CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000`. Per Opus 4.7 release notes, the new tokenizer uses 1.0×–1.35× more tokens than 4.6 on the same text. Anthropic explicitly recommends bumping `max_tokens` further when running `xhigh`/`max`.

**Recommended:** raise to 96000 if any synthesis-tier agent (security-synthesizer, refactor-pre-verifier, docs-verifier) ever truncates. Subagents remain capped at 32K regardless (Anthropic-documented).

### 2.6 Settings hygiene checks (MED / trivial)

Audit items:
- `permissions.defaultMode: "auto"` — correct for a power user. Auto-mode classifier is now GA on Max (Tygart Media, 4.7 launch). Kept.
- `CLAUDE_CODE_NO_FLICKER=1` — correct on v2.1.89+. Kept.
- `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1` — correct. Kept.
- **Verify absence:** `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT` should NOT be set — it forces effort support across all models including Haiku where it doesn't apply.
- **Verify absence:** `CLAUDE_CODE_SUBAGENT_MODEL` is intentionally unset (per `public/CLAUDE.md`); leave it that way. Setting it would override per-agent frontmatter in the docks plugin (priority 1 in Claude Code's resolution order).
- **Verify absence:** `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` should NOT be set — it's session-level orchestration where multiple Claude Code instances share a task list, a different tool from the kit's intra-session subagent pattern.

`skillListingBudgetFraction: 0.025` is the defensive setting and stays here. The structural Cursor-style "names + descriptions only, body fetched on demand" pattern is a docks-side rewrite (see `agent_optimization_docks.md` §C.2).

---

## Section 3 — Hooks (`ssot/.claude/hooks/` + settings.json `hooks` block)

### 3.1 Migrate `SubagentStop` validator from regex to `prompt`/`agent` hook (MED / moderate)

Current: bash regex check for `file:line` + whitelist for "no issues found" / mode-selection responses.

**Issue:** whitelist drift; regex misses semantically valid outputs that lack literal `path/to/file.ts:42` (e.g., findings that cite line ranges, conventions, or ADR references without a colon).

**Recommended:** use the new `prompt` hook type (released 2026):

```json
{
  "type": "prompt",
  "prompt": "Evaluate whether the subagent's output meets these requirements: (1) any code-level finding cites file:line (single line or range); (2) mode-selection responses or 'no issues found' are exempt. Return {ok: true} or {ok: false, reason}.",
  "timeout": 30
}
```

For deeper checks, use the `agent` hook type (subagent with `Read`/`Grep`/`Glob`, 60s timeout) to verify the cited file:line actually exists. Catches **fabricated citations** — a real failure mode in code-review subagents.

### 3.2 Add `PostToolUseFailure` hook (MED / trivial)

Event added 2026. Inject `additionalContext` on tool failure — e.g., on `Bash` failure include "git status / build state changed; consider re-reading the file before retrying." Particularly valuable on the Phase-2 parallel scanners where a single bash failure can derail a fan-out.

```json
"PostToolUseFailure": [
  {
    "matcher": "Bash",
    "hooks": [
      {
        "type": "command",
        "command": "echo 'Last bash failed. State may have shifted — consider re-reading affected files before the next attempt.'",
        "timeout": 5
      }
    ]
  }
]
```

### 3.3 `PostToolBatch` hook — pilot only (LOW / moderate)

New event runs after every tool call in a batch resolves. For the "parallel scanners launched in single tool-call turns" pattern, this is the natural place to validate cross-scanner consistency or trigger an early Builder phase if all scanners agree.

This is plugin-flow specific. The docks-side commands (`/docks:security` Phase 2 in particular) are the consumers. Keep this in the public roadmap as "low-effort pilot when the docks side has a clear use case."

### 3.4 SessionStart `disable-claudeai-connectors.sh` — keep as-is

Anthropic has not shipped a fix for `ENABLE_CLAUDEAI_MCP_SERVERS` as of May 2026 (issues #45158 and #44272 both OPEN). The kit's `disable-claudeai-connectors.sh` patching `disabledMcpServers` is the documented working workaround.

The hook fires on **every** SessionStart event (no `startup` matcher) so it covers `resume` / `compact` / `clear` — already correctly configured per `public/CLAUDE.md` § Hooks. Leave it.

Optional polish: also export `ENABLE_CLAUDEAI_MCP_SERVERS=false` at shell-profile level as belt-and-suspenders for fresh sessions. Cannot be set in `settings.json` because Claude Code reads it before settings.json loads.

### 3.5 RTK PreToolUse — verify scope on native binaries (HIGH / trivial verification)

Claude Code's native macOS/Linux builds replaced `Glob`/`Grep` with embedded `bfs`/`ugrep` accessible via Bash (v2.1.111+ per claudefa.st changelog). This expands RTK's effective coverage — operations that previously bypassed the hook now route through Bash and pick up RTK's 60–90% compression.

Verify: `which claude` should resolve to the native binary; `rtk gain --history` should show compression on what used to be `Glob`/`Grep` operations.

### 3.6 Hook composition — current pattern is correct, no change

Two SessionStart blocks (one with config-injection commands, one without matcher for `disable-claudeai-connectors.sh`) is a documented pattern. Anthropic docs note that on `resume`, mid-session events replay saved text rather than re-running, so static info should still go in CLAUDE.md, not hooks — current setup respects this.

### 3.7 `fetch-usage.sh` async Stop hook — already correct

`"async": true` is set on the Stop hook for `fetch-usage.sh`. Aligns with January-2026-shipped capability. No change.

### 3.8 Notification hooks beyond `alert_bubble.mp3` — optional polish

Mobile push (Pushover/ntfy), Slack via webhook etc. are common community patterns (disler/claude-code-hooks-mastery, eesel reference). Optional for a personal kit; out-of-scope for SSOT unless others request it.

### 3.9 Hook security checklist

Verify (currently looks fine):
- HTTP hooks must use `allowedEnvVars` for any env-var interpolation in URLs (Anthropic-documented). The kit has no HTTP hooks today; flag if added.
- Hook output cap is 10K chars; exceeding writes to file with preview.
- Built-in `Bash` returns a structured object — if any hook does `updatedToolOutput`, schema must match or it's silently ignored.

---

## Section 4 — `ssot/.claude/CLAUDE.md` (global heuristics)

### 4.1 The 8 Distilled Heuristics — gaps to fill

The 8 heuristics in `ssot/.claude/CLAUDE.md` are accurate distillations of Cursor's Agent Prompt 2.0 (2025-11-07 leak; verified against x1xhlol/system-prompts-and-models-of-ai-tools). Cursor's 2026 changes have been architectural (dynamic context discovery, Composer 2, /multitask, /best-of-n) rather than prompt-rule, so these eight remain current.

**Heuristics worth ADDING** (each HIGH confidence, with Anthropic primary source):

1. **Literal-instruction rule (Opus 4.7 specific):** "Opus 4.7 follows instructions literally and does not silently generalize. Phrase requirements as explicit checklists with success criteria, not narrative. The model fails *closed*, not open." — Anthropic 4.7 best-practices, Notion's reported test results.

2. **Subagent restraint:** "Opus 4.7 spawns fewer subagents by default. To parallelize, instruct explicitly: 'Spawn N subagents in parallel for items X, Y, Z.' Do not assume fan-out happens automatically." — Anthropic 4.7 release notes.

3. **Cache-invariance rule:** "Do not insert timestamps, mutable state, or rotating tool definitions into the system prompt. Put dynamic context in `<system-reminder>` tags inside user messages. Tool sets are part of the cached prefix; mid-session changes invalidate cache." — Anthropic engineering blog "Lessons from building Claude Code: Prompt caching is everything"; Claude-Code-Camp's measured 5× cost penalty on cache breaks.

4. **Don't switch models mid-session:** "Caches are per-model. Switching Opus→Sonnet mid-session forces a cold-start cache write that often costs more than just continuing on Opus. Use subagents for cross-model work instead." — same source as #3.

5. **Compact proactively, not reactively:** "Proactive `/compact` at 50–60% beats waiting for autocompact. The model is at its least intelligent when compaction fires due to context rot." — Thariq Shihipar's April 15, 2026 session-management post (already cited in `public/CLAUDE.md`).

6. **`/rewind` over correction:** "When the model heads down a wrong path, prefer `/rewind` to a previous turn over chained corrections. Corrections accumulate noise; rewinds preserve the prefix and discard the bad branch." — same source.

7. **Files over tools for large/repeated context:** "When tool output is large, persist it to file and reference by path. When it's needed again, read scoped lines via `Read` with `offset`/`limit`, not whole-file re-reads." — Cursor's January 2026 dynamic-context-discovery blog (46.9% token reduction); now also the documented agentskills.io progressive-disclosure pattern.

8. **Bash CLI > MCP for the same capability:** "Prefer Bash CLIs (`gh`, `jq`, `curl`) to MCP servers when both exist. CLI tools don't load tool schemas into the prefix; MCP tools do." — Boris Cherny / Builder.io 50-tips article; corroborated by Cursor's 40-tool ceiling research.

These slot in cleanly as numbered heuristics #9–#16. The existing **"treat the 8 heuristics above as protocol, not preference"** `<constraint>` block should be updated to reference all 16.

### 4.2 Research-Before-Implementation block — keep, add fallback rule

The context7 → resolve-library-id → query-docs → WebFetch flow matches Anthropic's own recommended pattern (effective-context-engineering blog) and OpenHands' "agentic search over semantic search" guidance.

**Suggested addition** (one-liner): "If context7 returns nothing for a library, fall back to `gh search code` then `WebFetch` the canonical docs URL." This handles the long tail of niche libraries.

### 4.3 Project Skills section — keep; verify against agentskills.io spec

The current section accurately describes:
- Frontmatter `name + description` only loads at session start (~100 tokens each)
- Body ≤500 lines, with split files referenced via paths
- CSO start-prefix requirement
- `upstream:` block for vendored skills

These are correct per agentskills.io (December 2025 standard, OpenAI Codex adopted same SKILL.md format). No change needed.

The deeper structural rewrite — "names + 1-line description in listing, full body fetched on demand via grep" — is a docks-side decision and lives in `agent_optimization_docks.md` §C.2.

### 4.4 Project Agents section — keep; verify resolution order

Current section correctly documents Claude Code's model-selection resolution order:
`CLAUDE_CODE_SUBAGENT_MODEL` env → per-invocation `model` param → frontmatter `model:` → parent.

Confirms the kit's choice to leave the env var unset is correct (priority 1 would override per-agent frontmatter). No change.

### 4.5 Cursor-system-prompt items to verify (one-time check)

Per the leaked Cursor Agent prompt and jujumilk3 corpus, things `ssot/.claude/CLAUDE.md` should already cover (verify presence — add if missing):

- "NEVER refer to tool names in user-facing text — say 'I will edit your file', not 'I'll use edit_file'"
- "Code edits must run immediately error-free; include all imports and dependencies"
- "Bias toward not asking the user — search first"
- "Before calling a tool, briefly explain why"

Most of these are implicit in Claude Code's system prompt, but explicit reinforcement in CLAUDE.md is cheap and doesn't break cache (it's a stable prefix).

---

## Section 5 — `sync.sh`, status line, RTK (validation, no changes)

### 5.1 `sync.sh` — flag matrix is correct

The orthogonal `--force` and `--remove-plugins` design (settings layer vs plugin layer) is the right factoring. Default-additive behavior protects user-only additions; flagged operations are explicit reconciliation. No change.

### 5.2 Plugin bootstrap — six-pass design holds up

The six idempotent passes via `claude plugin {marketplace add, install, marketplace update, update, uninstall, marketplace remove}` correctly handle the SSOT-vs-installed reconciliation. No change.

### 5.3 Status line — `fetch-usage.sh` async + cache file

Two-line display is documented and working. The `async: true` flag is set; cache at `/tmp/.claude_usage_cache` is documented in troubleshooting.

### 5.4 RTK — pinned correctly, with documented gotcha

`rtk hook claude` (direct, no shim) is correct for RTK 0.38.0+. The `rtk init -g` clearing `PreToolUse` to `[]` even on N gotcha is documented in `public/CLAUDE.md`. The `sync.sh` skip-if-RTK.md-exists guard prevents tripping on routine syncs. No change.

---

## Section 6 — Things `public` Does Exceptionally Well

Reinforcement — don't break these:

1. **`CLAUDE_CODE_SUBAGENT_MODEL` left unset deliberately.** Per anthropics/claude-code issue #25546, this env var only affects agents *without* explicit model declaration. The plugin's per-agent frontmatter pattern is the recommended way; don't set the global override.

2. **`alwaysThinkingEnabled: true`** — correctly opts into adaptive thinking on every turn. On 4.7, adaptive thinking is off by default at the API layer and must be explicitly enabled.

3. **Dual SessionStart hook design** (config-injection + connector-disable) — handles `resume`/`compact`/`clear` correctly via no-matcher fallback. Documented and audited.

4. **94% main-agent cache-hit rate** is in the same league as Anthropic's own production claim of 92%. System prompt is being kept stable. Don't break this by adding mutable values to it.

5. **Plugin selection** — official Anthropic plugins (agent-sdk-dev, commit-commands, context7, frontend-design, code-simplifier, claude-md-management, skill-creator, php-lsp) are first-party and well-vetted. `frontend-design` alone has 277K+ installs. The per-project plugin scoping pattern (n8n-mcp-skills `false` in SSOT, `true` per-project) is a clean solution to Claude Code issue #27247.

6. **`alert_bubble.mp3` Notification hook + `fetch-usage.sh` async Stop hook** — both align with documented community best practices. Async Stop hook correctly using the January-2026-shipped `async: true` capability.

7. **RTK PreToolUse** — correctly scoped, well-corroborated (madplay, lmmartinb, codestz, x-cmd, Builder.io, Kilo-Code discussion all confirm 60–90% reduction).

8. **Open Concerns section in `public/CLAUDE.md`** — explicit verify-resolution criteria with linked GitHub issues per entry. Prevents drift on wait-on-upstream items. Already covers Opus 4.7 thinking-summary bug correctly.

9. **`docs/roadmap/` convention** — distinct from Open Concerns (kit-internal vs wait-on-upstream); time-boxed checkbox tracking with `git mv` between `planned/` → `ongoing/` → `finished/`. Strong shipping discipline; convention file at `docs/roadmap/CLAUDE.md`.

---

## Section 7 — Measurements `public` Should Run

Each is a real decision the public web can inform but not settle. Run on a `/docks:refactor` or `/docks:security` fixture and use 3-run averages.

1. **Fork-subagent impact.** With `CLAUDE_CODE_FORK_SUBAGENT=1` enabled (and docks-side `context: fork` opt-ins): capture `cache_read_input_tokens` before/after on the Phase-2 parallel-scanner fan-out. Hypothesis per Anthropic patch notes: 5–10× reduction on input tokens for children 2-N.

2. **Subagent prompt-cache verification.** Per issue #29966, parallel scanners may not be caching. Instrument the same `cache_read_input_tokens`/`cache_creation_input_tokens` and confirm. If broken, the one-line workaround is documented and savings are dramatic.

3. **400K vs 200K vs 1M context cap.** Three-way A/B per §2.3. Quality metric: verifier's "did it find all bugs" rate, not just wall-clock.

4. **`max_tokens` headroom.** Run a synthesis-tier agent (security-synthesizer or refactor-pre-verifier) at the current 64K cap and at 96K. Look for truncation events on long syntheses.

5. **Skill-listing-budget impact.** Capture system-prompt prefix size before and after switching to the Cursor-style "names + 1-line desc, body fetched on demand" pattern (this is a docks-side rewrite tracked there; `public` measures the system-prompt-size delta).

6. **`/ultrareview` comparison.** Run Anthropic's multi-agent reviewer fleet against `/docks:security` on the same diffs. Sub-1% false-positive rate is the bar (Anthropic internal data via per-finding-reproduction). If `/docks:security` matches or beats it, publish the kit; if not, study the per-finding-reproduction step.

7. **Plan-brittleness check.** Inject a deliberate mid-run failure (delete a file the planner expects) and measure whether the orchestrator re-plans gracefully. Anthropic's 2026 Architecture Patterns taxonomy lists this as the #1 plan-and-execute failure mode.

---

## Section 8 — Caveats

- **Source weighting:** where Anthropic's official docs and a community blogger disagree (e.g., 1M context as a quality win), both views are reported. The kit's `CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000` is a defensible split-the-difference position.
- **Effort: max** — the original audit's "drop default to xhigh" recommendation is **rejected** for this repo per kit policy. Anthropic's "diminishing returns / overthinking" framing is acknowledged but the kit accepts that token cost in exchange for orchestrator-tier ceiling.
- **Future-tense claims:** the advisor tool (GA April 9, 2026) and task budgets (still beta as of v2.1.123) appear in the docks doc, not here — they're per-agent / per-call concerns.
- **Bug overlap:** issues #45158 (project-level disable claudeai connectors), #44272 (per-server allowlist), #25546 (model override on built-in agents), #29966 (subagent prompt caching), #49708/#49268/#48065 (showThinkingSummaries on 4.7) are all confirmed open as of May 2026. No quick Anthropic fix announced.
- **94% cache-hit rate** is the *prefix cache* (Anthropic prompt-caching mechanism), not the model-internal KV cache. Public discussion (mager.co, dailydoseofds, claudecodecamp) is consistent that prompt cache is the relevant lever.
- **Empirical numbers** (10×, 30%, etc.) are derived from cited sources; on the kit's specific workload, expect variance. §7 is the way to confirm.

---

## Cross-references

- Plugin-internal optimizations (per-agent frontmatter, command bodies, agentskills.io structural compliance, Builder-Verifier reproduce-step, advisor tool, task budgets, skill-listing on-demand restructure, Phase-4/5 cost-concentration audit): see `docs/optimization-audit-may-2026.md` in the [docks plugin repo](https://github.com/DocksDocks/docks).
