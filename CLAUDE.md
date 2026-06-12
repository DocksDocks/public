@AGENTS.md

## Claude Code

Configuration specific to Claude Code. `SoT/.claude/` is the Single Source of Truth that gets synced to `~/.claude/` by `./sync.sh`. Edit files in `SoT/.claude/` here in the repo, then run sync — never edit `~/.claude/` directly. The skills, commands, and multi-agent pipeline ship as a separate plugin: **[DocksDocks/docks](https://github.com/DocksDocks/docks)**.

### Repository structure (Claude-specific)

| Path | Purpose |
|------|---------|
| `SoT/.claude/CLAUDE.md` | Coding standards and conventions (synced to `~/.claude/CLAUDE.md`) |
| `SoT/.claude/settings.json` | Permissions, hooks, plugins, env vars, token limits |
| `SoT/.claude/hooks/` | Hook scripts (e.g. `notify.sh` — the Notification completion sound) |
| `SoT/.claude/statusline.sh` | Two-line status bar (model, git, usage, context) |
| `SoT/.claude/fetch-usage.sh` | API usage fetcher for status line (async, cached) |

### Plugins

Configured in `SoT/.claude/settings.json` under `enabledPlugins` and `extraKnownMarketplaces`.

| Plugin | Source | Purpose |
|--------|--------|---------|
| `docks` | [DocksDocks/docks](https://github.com/DocksDocks/docks) | Multi-agent pipeline plugin — parallel-agent slash commands (where parallel-agent value is irreducible), portable skills, and Opus/Sonnet-tiered subagents. See the plugin README for the current inventory |
| `n8n-mcp-skills` | [czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills) | n8n workflow skill pack — teaches Claude Code how to author production-ready n8n workflows. Globally **disabled** in SoT (`enabledPlugins[...]: false`); enabled per-project via `.claude/settings.json` only in n8n repos to keep ~7 skills out of unrelated projects' system prompt |
| `supabase` (official) | built-in `claude-plugins-official` | Bundles two skills (`supabase` for the full product surface — Auth/Database/Edge Functions/Realtime/Storage/Vectors/Cron/Queues/Postgres extensions — and `supabase-postgres-best-practices` for Postgres performance/schema guidance) plus the `supabase` MCP server. Globally **disabled** in SoT (`enabledPlugins[...]: false`); enabled per-project via `.claude/settings.json` only in repos that touch Supabase or Postgres, to keep both skill descriptions + the MCP tool surface out of unrelated projects |
| `effect-kit` | [DocksDocks/effect-kit](https://github.com/DocksDocks/effect-kit) | Cross-tool Effect-TS skill kit — `effect-ts-setup` (repo bootstrap), `effect-ts-specialist` (idiomatic Effect 3.x patterns), `effect-ts-port` (Fastify/Next.js/React → Effect migration). Skills only (no agents); globally enabled (`true`). Codex sees it as `effect-kit@docks` (added to the personal marketplace file alongside `docks`). Optional companion CLI `effect-solutions` (Kit Langton's idiomatic-Effect docs) is auto-installed by `./sync.sh --agents` via Bun and symlinked into `~/.local/bin` — the skills work without it. Note: effect-kit also bundles productivity skills (`context-tree`, `plan-init`, `plan-manager`, `plan-review`, `write-skill`) that duplicate docks' by name; they remain namespaced (`effect-kit:*` vs `docks:*`) but add to the skill-listing budget |

#### Per-project plugin scoping

`enabledPlugins` values carry three distinct meanings in this kit:

| Value | Meaning | sync.sh `--remove-plugins` |
|-------|---------|----------------------------|
| `true` | Installed + enabled in every project | keeps installed |
| `false` | Installed + globally disabled; project-level `.claude/settings.json` can flip to `true` per-repo | keeps installed |
| key absent | Not installed | uninstalls if currently installed |

Per-project enable lives in the project's `.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "n8n-mcp-skills@n8n-mcp-skills": true
  }
}
```

The user-scope key MUST remain present (just `false`) — Claude Code [silently ignores](https://github.com/anthropics/claude-code/issues/27247) project-level `enabledPlugins` entries whose key is absent from user settings. That's why this kit prefers `false` over deletion for situationally-useful plugins.

Reference examples in this repo:
- `n8n-mcp-skills` is `false` in SoT and `true` in `n8n-workflows/.claude/settings.json`. To extend to another n8n project: copy the project-level `enabledPlugins` block into that repo's `.claude/settings.json`.
- `supabase@claude-plugins-official` is `false` in SoT. To enable in a Supabase/Postgres project, add `"supabase@claude-plugins-official": true` to that repo's `.claude/settings.json` (or `.claude/settings.local.json` for personal scope). Don't reference the upstream `supabase/agent-skills` marketplace — the postgres skill is bundled inside the official `supabase` plugin, and pointing at the upstream marketplace produces a stale "Plugin not found" warning in `/doctor` because that marketplace was never registered locally.

#### Install plugins on a new machine

`./sync.sh` handles this automatically. After the settings merge it reads `extraKnownMarketplaces` and `enabledPlugins` from the SoT and runs `claude plugin marketplace add` + `claude plugin install` for anything missing from `~/.claude/plugins/known_marketplaces.json` / `installed_plugins.json`. Both CLI commands are idempotent, so reruns are no-ops.

The bootstrap exists because **`extraKnownMarketplaces` declarations in settings.json are not auto-cloned**. Without it, `/reload-plugins` reports `Plugin <X> not found in marketplace <Y>` even though the marketplace block is present in settings.json. Adding a new third-party plugin? Add it to both `enabledPlugins` and `extraKnownMarketplaces` in `SoT/.claude/settings.json`, then run `./sync.sh`. To pick up the new plugin in an active session, run `/reload-plugins`.

Official plugins (`context7`, `frontend-design`, `agent-sdk-dev`, `commit-commands`, `php-lsp`, `typescript-lsp`) are auto-installed by Claude Code from the built-in `claude-plugins-official` marketplace; the `enabledPlugins` declarations just keep them enabled. `claude-md-management` and `skill-creator` are deliberately absent — the docks plugin's skill-authoring surface (`docks:write-skill`, `docks:skill-maintenance`) covers them; `code-simplifier` was dropped as unused.

The two LSP plugins (`php-lsp`, `typescript-lsp`) carry no skill or context cost — their `lspServers` config ships in the marketplace manifest (the plugin dirs on GitHub contain only a README; that's expected, not a broken install) and registers go-to-definition / find-references / post-edit diagnostics for `.php` and `.ts`/`.tsx`/`.js`/`.jsx` files. They are a no-op until the language-server binary is on PATH — `./sync.sh --claude` auto-installs the missing ones (`claude::sync_lsp_servers`: `npm install -g intelephense typescript-language-server typescript`; warns and skips when npm itself is absent). nvm-based installs are only on the PATH of interactive shells, which covers normally-launched Claude Code sessions but not headless/cron agents.

**Manual fallback** (only if the `claude` CLI isn't on PATH during sync — sync prints a warning and skips bootstrap):

```bash
/plugin marketplace add DocksDocks/docks
/plugin install docks@docks
/plugin marketplace add czlonkowski/n8n-skills
/plugin install n8n-mcp-skills@n8n-mcp-skills
/reload-plugins
```

### RTK (Rust Token Killer)

Token-optimized CLI proxy that reduces LLM token consumption by 60-90%. A PreToolUse hook transparently rewrites Bash commands (e.g., `git status` → `rtk git status`) so output is compressed before it reaches the context window.

*Verified working: **rtk 0.42.3** ([release notes](https://github.com/rtk-ai/rtk/releases/tag/v0.42.3), 2026-06-05). Upgrade rationale and supply-chain notes live in commit messages; only the current verified version is recorded here.*

`rtk init -g` generates `~/.claude/RTK.md` and the `@RTK.md` import in `~/.claude/CLAUDE.md`. The PreToolUse hook entry comes from this kit's SoT (`SoT/.claude/settings.json`) — the command is `rtk hook claude` (direct, no shim script). RTK 0.38.0 dropped the previous `~/.claude/hooks/rtk-rewrite.sh` shim; older docs that mention it are stale.

<constraint>
**RTK upgrade gotcha** — `rtk init -g` rewrites `~/.claude/settings.json` and **clears `hooks.PreToolUse` to `[]` even when its "Patch existing settings.json? [y/N]" prompt defaults to N** (observed RTK 0.38.0, 2026-05-05). It prints a "MANUAL STEP: add this hook" message after destroying the existing one. Never run `rtk init -g` blindly during an upgrade — either snapshot `~/.claude/settings.json` first and restore the `PreToolUse` block after, or just re-run `./sync.sh --force` to redeploy the SoT entry. The kit's `sync.sh` skips `rtk init -g` when `~/.claude/RTK.md` already exists, so it won't trip on routine syncs — only manual invocations.
</constraint>

#### Supported commands

git, gh, cargo, cat, grep/rg, ls, tree, find, diff, head, vitest, tsc, eslint, prettier, playwright, prisma, docker, kubectl, curl, wget, pytest, ruff, pip, mypy, go test/build/vet, aws, psql, and more.

#### Install RTK (Linux)

```bash
# 1. Install the rtk binary (download-then-run; see note)
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh -o /tmp/rtk-install.sh
bash /tmp/rtk-install.sh
rm /tmp/rtk-install.sh
# NB: avoid `curl … | bash` — the pipe can truncate mid-stream (observed on the 0.38 → 0.39 upgrade, 2026-05-06; "unexpected EOF while looking for matching `}'" with no other diagnostics). The upstream installer also has bashisms, so `curl … | sh` would fail on Debian/Ubuntu where /bin/sh is dash.

# 2. Ensure jq is installed (required by the hook)
sudo apt install -y jq   # Debian/Ubuntu
# or: sudo pacman -S jq  # Arch

# 3. Initialize RTK globally (generates hook + configures Claude Code)
rtk init --global

# 4. Add "Bash(rtk:*)" to permissions.allow in ~/.claude/settings.json

# 5. Verify
rtk --version        # Should print version
rtk ls .             # Should show compressed output
rtk gain             # Should show tracking is active

# 6. Restart Claude Code for the hook to take effect
```

### Status Line

Two-line display inspired by [claude-watch](https://github.com/xleddyl/claude-watch). Cross-platform (macOS + Linux).

- **Line 1**: Model name | folder | git branch
- **Line 2**: 5h/7d API usage with reset countdowns | context window usage with token counts

Requires `jq` and `curl`. Usage data is fetched via the `Stop` hook and cached to `/tmp/.claude_usage_cache`.

### Session Management

Based on https://claude.com/blog/using-claude-code-session-management-and-1m-context. The 468K compact window is a *fallback*; the habits below keep sessions crisp in the first place.

| Signal | Action | Why |
|--------|--------|-----|
| Related follow-up, same working set | **Continue** | Everything in context still matters |
| New task starting | **`/clear`** | Zero rot; you control what carries forward |
| Wrong path, same task | **`/rewind`** (double-tap `Esc`) | Undo the detour before it pollutes context |
| Same task, context getting heavy | **`/compact` with steering** | Direct Claude what to keep ("preserve the failing test + stack trace; drop the exploration") |
| Work will produce output you only need the conclusion of | **Subagent** | Keeps verbose output out of the parent context |
| Side task that needs the full conversation context | **`/fork <directive>`** (enabled by default since Claude Code v2.1.161) | Spawns a subagent inheriting full message history, system prompt, tools, and model. First request reuses the parent's prompt cache. |
| Long-horizon task with a checkable end state | **`/goal <condition>`** | Completion condition evaluated after every turn by a fast model; Claude keeps working until it holds. Complements auto mode: auto removes per-tool prompts, `/goal` removes per-turn prompts. Survives `--resume` |
| Big task that warrants orchestrated parallel fan-out | **`ultracode`** keyword in the prompt (or `/effort ultracode` session-wide) | xhigh effort + dynamic workflows: up to 16 concurrent subagents whose intermediate results stay out of the main context. Session-only — no persistent settings key; workflow subagents always run `acceptEdits` with your allowlist |
| Need to move the working directory | **`/cd`** (v2.1.169) | Changes cwd without breaking the prompt cache |

Rule of thumb: if a turn starts with "that didn't work, try X instead," reach for `/rewind` before retrying — the failed attempt is context rot you're otherwise carrying forward.

The docks plugin's commands already use Opus-orchestrator + sonnet-subagents internally. The blog validates that pattern for ad-hoc work too. **`/fork` is for ad-hoc exploration, not for plugin command pipelines** — those intentionally isolate phases (fresh context per subagent, plan-file as the only handoff) to keep token costs predictable.

### Permission Mode

The kit sets `permissions.defaultMode: "auto"` — new sessions boot directly into auto mode. Claude Code 2.1.152+ removed the one-time opt-in consent that `skipAutoPermissionPrompt` previously suppressed; the key is no longer needed. Docs: https://code.claude.com/docs/en/permission-modes.

The `Shift+Tab` cycle — `default` → `acceptEdits` → `plan` → `auto` — is Claude Code's **autonomy slider** (Karpathy's framing from the [Software Is Changing (Again)](https://singjupost.com/andrej-karpathy-software-is-changing-again/) YC talk, June 2025: "less Iron Man robots and more Iron Man suits … partial autonomy products"). Cycle from the high-autonomy end down toward `default` for fine-grained review, back up for hands-off execution.

The classifier tradeoff: the classifier that gates each action in auto mode is an API call in its own right. When that service has a transient outage, every Edit/Bash is blocked until it recovers. When that happens, cycle away with `Shift+Tab` until the classifier recovers. Fallbacks are baked in anyway — see "Fallbacks" below.

**Requirements** for auto mode (the kit meets them on a Max subscription):
- Plan: Max / Team / Enterprise / API (not Pro)
- Model: **Opus 4.6 or later, or Sonnet 4.6** (the earlier Max-specific "Opus 4.8 only" restriction is gone from the current permission-modes doc). Fable 5 is not yet explicitly listed — if the classifier rejects a Fable session, `Shift+Tab` away or `/model opus` until the doc catches up
- Provider: Anthropic API only (not Bedrock, Vertex, Foundry)
- Claude Code v2.1.83+

**What changes when auto mode is active:**
- Broad wildcard allow rules (`Bash(git *)`, `Bash(npm *)`, etc.) are dropped — everything routes through the classifier instead. Narrow rules like `Bash(npm test)` carry over.
- The `deny` list is still enforced.
- Protected paths (`.git`, `.claude`, `.mcp.json`, etc.) route to the classifier rather than being auto-approved.
- Dropped rules are restored the moment you leave auto mode.

**Cutting auto-mode false positives — `autoMode.environment`:** the classifier blocks anything aimed *outside* your environment; out of the box it trusts only the working dir and the current repo's remotes. To stop it flagging routine pushes to your other org repos or writes to trusted buckets, add an `autoMode.environment` array (prose entries; include the literal `"$defaults"` to keep the built-ins) to **`~/.claude/settings.local.json`** — not the shared SoT: the classifier ignores `autoMode` in checked-in project `.claude/settings.json`, and trusted-infra is machine-specific. The block also accepts `allow`/`soft_deny`/`hard_deny` prose lists, but `permissions.deny` (which runs *before* the classifier) stays the only unbypassable gate. Inspect the effective rules with `claude auto-mode config`; critique custom rules with `claude auto-mode critique`. Docs: https://code.claude.com/docs/en/auto-mode-config.

**Fallbacks baked in**: 3 consecutive classifier blocks or 20 total in a session pause auto mode and resume prompting. Approving the prompted action resumes auto. Not configurable.

**When to bail out of auto mode**: classifier outage, sensitive production work, CI migrations, anything where you want to review each step. `Shift+Tab` cycles away from auto.

### Hooks

- **SessionStart**: Injects current date/time and active config (context window, compact-window cap, effort level, thinking mode, subagent model) so agents don't rely on training data cutoff
- **Claude.ai connector disable** — handled by `ENABLE_CLAUDEAI_MCP_SERVERS=false` exported in your shell rc, which `sync.sh` adds via `claude::sync_connector_env` (idempotent; surgical — only claude.ai cloud connectors, MCP source #5, are disabled; plugin/project servers like supabase/n8n are untouched). The old `disable-claudeai-connectors.sh` SessionStart hook — which patched `disabledMcpServers`, a field that does *not* gate account-synced connectors — was non-functional and has been **removed**. See Open Concern [2026-06-08]
- **Notification**: Plays `alert_bubble.mp3` via `ffplay` when a task completes
- **PreToolUse (Bash)**: RTK hook rewrites commands for token-compressed output
- **Stop**: Fetches API usage stats (async) to keep status line data fresh
- **SubagentStop**: Blocks subagent completion if output lacks concrete `file:line` references (allows "no issues found" / mode-selection responses through)

### Environment Variables

All configured in `SoT/.claude/settings.json` under the `env` block. The centerpiece strategy is **`model: best` (Fable 5 where the org has access, latest Opus otherwise) + 468K compact window (`--fable` raises it to 1M for disposable containers) + high effort (Fable-period pin; revert to xhigh on Opus) + per-agent-tiered subagents** — ceiling-level reasoning with the compact trigger as the per-machine knob; capability first, token cost second. Tuned for Fable 5 / Opus 4.8, which removed `budget_tokens` and made adaptive thinking the only thinking-on mode.

#### Context management

| Variable | Value | Purpose |
|----------|-------|---------|
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | `468000` | Cap the effective window at 468K; full autocompact fires at the default ~95% → ~445K. Raised from the Opus-era 350K on 2026-06-10: Fable 5's resolution holds well to ~468K in observed host-machine sessions, so the Opus-rot cap was discarding usable retention. Context rot still applies (**rot is gradual and continuous, steepest early; the exact slope is task-dependent** — the Chroma study found Claude decays slowest of all models, measured on Opus 4 / Sonnet 4); 1M stays enabled as headroom — rot tracks tokens *used*, not window size. The full-1M `./sync.sh --claude --fable` override is for disposable containers only, never host machines. Drop back to `350000` when the primary machine returns to Opus (expected ~2026-06-22). Docs: https://code.claude.com/docs/en/env-vars, https://research.trychroma.com/context-rot. |
| (implicit) 1M context | enabled by default | `CLAUDE_CODE_DISABLE_1M_CONTEXT` is **not** set, so 1M is active on Max/Team/Enterprise plans for Fable 5 / Opus 4.7+. Note: 4.7 introduced a new tokenizer that may consume up to 1.35× more tokens than 4.6 on the same text (carried forward in 4.8) — a reason to keep the compact window in absolute tokens rather than as a percentage. |

The status bar keeps showing context usage against the model's full window (1M); `CLAUDE_CODE_AUTO_COMPACT_WINDOW` decouples the compact trigger from `used_percentage`. Intentional: you still see real consumption; compaction just fires earlier.

#### Thinking & reasoning

Opus 4.7 removed `budget_tokens` (returns 400 error) and makes **adaptive thinking the only thinking-on mode**; 4.8 inherits this. Fixed budgets and `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` are gone.

| Variable | Value | Purpose |
|----------|-------|---------|
| `effortLevel` (top-level key, NOT the env var) | `high` | Valid: `low`/`medium`/`high`/`xhigh`. Both Opus 4.8 and Fable 5 default to `high`. Lowered from `xhigh` on 2026-06-12 for the Fable-5 access window: Anthropic's Fable 5 guidance is "start with `high` for most tasks" — lower effort on Fable 5 often exceeds `xhigh` on prior models, and `xhigh`'s stated niche is 30-min+ runs with token budgets in the millions (ultracode pairs `xhigh` for those anyway). **Revert to `xhigh` when the primary machine returns to Opus (expected ~2026-06-22)** — on Opus 4.7/4.8 the official recommendation for coding/agentic work remains `xhigh` ([effort doc](https://platform.claude.com/docs/en/build-with-claude/effort)). **Deliberately the settings key, not `CLAUDE_CODE_EFFORT_LEVEL`**: the env var is priority 1 in effort resolution and overrides per-skill/per-subagent `effort:` frontmatter (added 2.1.78–2.1.80), which would kill plugin-declared effort tiering — the settings key sets the session baseline while frontmatter wins when a skill/agent is active. Trade-off: only the env var can persist `max`; the kit deliberately avoids it (`max` can overthink structured tasks). Model-transition quirk: a new model's first run may reset settings-level effort to the model default — sync re-asserts the SoT value; confirm with `/effort`. |

#### Model selection

The kit sets **`"model": "best"`** in settings.json (Claude Code 2.1.170+): the alias resolves to **Fable 5** where the org has access and to the **latest Opus** otherwise — maximum-capability tier with a graceful fallback, and future top-tier releases land automatically. Cost is accepted (Fable 5 is $10/$50 vs Opus's $5/$25 per MTok; on subscriptions Fable draws usage credits after the launch window) — this kit optimizes capability first. To drop one machine back to Opus, set `"model": "opus"` in `~/.claude/settings.local.json`. `ANTHROPIC_DEFAULT_OPUS_MODEL` stays unpinned so the Opus fallback also auto-tracks; to pin during a known-bad release, set it in `settings.local.json`.

**Fable classifier fallback:** Fable 5's cyber/bio safety classifiers auto-switch a flagged session to Opus 4.8 (toggle: `/config` → "switch models when a message is flagged", the `switchModelsOnFlag` key); the session stays on Opus until `/model fable`. `claude --safe-mode` (2.1.169) starts with all customizations off to isolate whether kit config trips a first-request flag.

**Subagent model selection:** not an env var. The docks plugin declares per-agent `model:` (sonnet/opus) in each agent's frontmatter. `CLAUDE_CODE_SUBAGENT_MODEL` is intentionally NOT set — it would override all per-agent declarations (it's priority 1 in Claude Code's resolution order per the [subagents doc](https://code.claude.com/docs/en/sub-agents#choose-a-model)) and block per-phase tiering. To force all subagents to one model temporarily (rollback), export `CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-4-6` — it wins over agent frontmatter.

**No `fallbackModel`:** the kit stays on the `best`-resolved model for the whole main thread. `fallbackModel` (v2.1.166+; accepts a chain of up to 3 models, now turn-scoped — the next message retries the primary, bounding the cache cost to one turn) would degrade to a lesser model on an overload (529) rather than dropping the turn. The stance is softer than it was, but retained: a silent quality dip mid-task is worse than a retried turn. Sonnet subagents are spawned deliberately via agent frontmatter, not as a fallback. To opt in per-machine during a known-bad-availability stretch, set `fallbackModel` in `~/.claude/settings.local.json`.

#### Output & UI

| Variable | Value | Purpose |
|----------|-------|---------|
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | `64000` | Max output tokens per response for the main session — Anthropic's recommended starting point for Opus 4.8 at xhigh/max effort. A higher cap *reduces the effective input context before auto-compaction* (per the env-vars doc), so the earlier 96K bump traded input headroom for output sizes coding turns rarely reach. Subagents are capped at 32K regardless, so this main-thread value never affected synthesis-tier output (the original reason for the bump). Opus 4.8's hard ceiling is 128K; raise only if real outputs truncate. |
| `CLAUDE_CODE_NO_FLICKER` | `1` | Fullscreen rendering mode, no terminal flicker, adds mouse support. Requires v2.1.89+. |
| `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR` | `1` | Keeps bash commands in the project working directory instead of resetting between calls. |

#### Top-level settings.json keys

| Key | Value | Notes |
|-----|-------|-------|
| `model` | `best` | Model alias pin (2.1.170+): Fable 5 where the org has access, latest Opus otherwise. See § Model selection for rationale and per-machine rollback. |
| `effortLevel` | `high` | See § Thinking & reasoning — settings-key pin chosen over the env var so plugin `effort:` frontmatter still applies. |
| `autoMemoryEnabled` | `true` | Explicit pin of the default: Claude writes per-repo notes to `~/.claude/projects/<project>/memory/` (first 200 lines / 25KB of MEMORY.md auto-loads each session; topic files load on demand). Pinned so a stray disable can't drift in — cross-session recall backs the prompt files' running-notes rule. |
| `skillListingMaxDescChars` | `2048` | Per-skill description char cap in the skill listing (default 1536). Several docks/effect-kit CSO descriptions exceed 1536 and would truncate mid-trigger-condition; 2048 keeps them intact. Context budget already covered by `skillListingBudgetFraction: 0.05`. |
| `alwaysThinkingEnabled` | `true` | Tells Claude Code to opt into adaptive thinking on every turn. On 4.7, adaptive thinking is off by default at the API layer and must be explicitly enabled — this flag handles that. Moot on Fable 5 (thinking cannot be disabled there), still load-bearing on the Opus fallback. |
| `showThinkingSummaries` | `true` | Display only; doesn't reduce token use. On 4.7, thinking content is omitted by default at the API layer; Claude Code opts in when this is true. |
| `viewMode` | `default` | Default transcript view on startup. Keeps tool I/O collapsed so the feed stays readable. Press `Ctrl+O` to cycle to `verbose` on demand. Enum: `default`/`verbose`/`focus`. |
| `skipDangerousModePermissionPrompt` | `true` | Suppresses `--dangerously-skip-permissions` warning. Ignored in project-level settings for safety. |
| `skillListingBudgetFraction` | `0.05` | Cap on system-prompt budget for skill descriptions (decimal 0–1, ~5% of the model's context window). Default `0.01` was dropping ~25 descriptions; `0.025` still dropped ~22 in projects with heavier plugin stacks (e.g. `supabase` + `docks:*` forks + `claude-plugins-official`), with `/doctor` reporting ~3.4% needed. `0.05` (~50K tokens on 1M Opus, ~12.5% of the 400K compact window) gives durable headroom for future skill additions and absorbs the ~7K-token opt-in cost `/doctor` cites for the dropped 22. Added in Claude Code 2.1.129+. To verify the warning is gone, run `/doctor` after sync; "Skill listing will be truncated" should not appear. |
| `minimumVersion` | `2.1.170` | Floor for auto-updates and `claude update` — a stale install upgrades to ≥2.1.170 on next launch, guaranteeing every synced machine carries the features the kit relies on (Fable 5 + the `best` model alias need 2.1.170; Opus 4.8 needs 2.1.154; `skillListingBudgetFraction` needs 2.1.129). Distinct from the managed-only `requiredMinimumVersion`. |

Effort is pinned via the top-level `effortLevel` key — never `CLAUDE_CODE_EFFORT_LEVEL`, which would override per-skill/subagent `effort:` frontmatter (the `removed` manifest prunes the env var from synced machines). The env var remains the only route to `max`; the kit doesn't use it.

#### Settings that do NOT belong in settings.json

| Setting | Correct location | Notes |
|---------|-----------------|-------|
| `showTurnDuration` | `~/.claude.json` | Triggers schema validation error in settings.json. `sync.sh` writes it to the right file. |

### Setup

```bash
# Clone and sync the kit
git clone <this-repo> ~/projects/public
cd ~/projects/public
./sync.sh                        # full sync + RTK bootstrap + plugin bootstrap (additive)
./sync.sh --dry-run              # preview before applying
./sync.sh --no-rtk               # skip RTK install (also strips @RTK.md import from CLAUDE.md)
./sync.sh --force                # replace ~/.claude/settings.json wholesale (settings layer only)
./sync.sh --remove-plugins       # uninstall plugins/marketplaces not in SoT (plugin layer only)
./sync.sh --force --remove-plugins   # full reset to SoT (both layers)
./sync.sh --claude --fable       # deploy-time: raise autocompact window to 1M for Fable 5 sessions (model unchanged)
./sync.sh --claude --permissive  # deploy-time: empty permissions.ask/deny — unattended commits/pushes in sandboxes
```

In an active Claude Code session, run `/reload-plugins` after `./sync.sh` to activate any newly installed plugins without restarting.

`sync.sh` auto-detects the repo location, merges `settings.json` (deep-merge with array concat+unique for `permissions.{allow,deny,ask}`), writes `showTurnDuration` to `~/.claude.json`, copies the status line scripts and hook scripts, and installs/initializes RTK if missing (or warns when the installed RTK is older than the latest GitHub release).

For plugins it runs seven idempotent passes via the `claude plugin` CLI:

| Pass | Mode | What it does |
|------|------|--------------|
| 1 | always | `claude plugin marketplace add` for any SoT `extraKnownMarketplaces` not yet cloned |
| 2 | always | `claude plugin install` for any SoT `enabledPlugins` key (true OR false) not in `installed_plugins.json`. `false`-keyed plugins still get installed so per-project enable has something to load. **Side effect:** `claude plugin install` enables the plugin at user scope (writes `"<id>": true` into `~/.claude/settings.json`), clobbering the `false` the settings merge wrote — pass 7 corrects this |
| 3 | always | `claude plugin marketplace update` (refresh manifests) |
| 4 | always | `claude plugin update <name>` for each installed plugin (idempotent — no-op when already at latest) |
| 5 | `--remove-plugins` | `claude plugin uninstall -y <name>` for installed plugins whose key is **absent** from SoT `enabledPlugins`. `false`-keyed plugins are preserved (intentionally listed as globally-disabled-but-installed) |
| 6 | `--remove-plugins` | `claude plugin marketplace remove <name>` for marketplaces **not** in SoT `extraKnownMarketplaces` (built-in `claude-plugins-official` is never removed) |
| 7 | always | Re-assert SoT enabled-state: rewrite `~/.claude/settings.json` `enabledPlugins` so SoT-declared values win (`(.enabledPlugins // {}) * $sot`), undoing pass 2's enable side effect. Without this, every `false`-keyed third-party plugin ships globally **enabled** — defeating the per-project scoping contract. User-only `enabledPlugins` entries are preserved |

For Codex plugins, after deploying `SoT/.codex/config.toml` and the personal marketplace file, sync runs `codex plugin add <plugin@marketplace>` for each enabled SoT plugin. Re-running sync therefore refreshes stale Codex plugin caches instead of only updating marketplace metadata. Sync also removes the older kit-created configured Docks marketplace source so Codex uses the personal marketplace file as the single source.

`--force` and `--remove-plugins` are orthogonal: `--force` reconciles `settings.json` via jq merge (SoT-declared keys win, `permissions.{allow,deny,ask}` arrays are replaced wholesale by SoT, user-only top-level keys and nested objects are preserved), `--remove-plugins` reconciles the plugin layer (uninstall + marketplace remove) AND the skills layer (uninstall kit-managed skills tracked in `~/.agents/.kit-managed-skills` that are no longer in `SoT/.agents/skills.txt`). Default sync is additive on all three layers — drift survives.

#### When to use `--force` and `--remove-plugins`

The default merge is additive on both layers: keys present in `~/.claude/settings.json` but absent from the SoT are preserved, and installed plugins not in SoT `enabledPlugins` are kept. This protects user-only additions, but it also means **drift accumulates** — neither flag-less reset can clean it up.

| Flag | Affects | Use when |
|------|---------|----------|
| `--force` | `~/.claude/settings.json` (kit-owned keys only) | Removing/renaming a settings key in SoT (env var, permission, hook); resetting after a schema warning; dropping locally-added permissions that diverged from SoT. User-only top-level keys (custom env vars, mcpServers, theme overrides) survive untouched |
| `--remove-plugins` | Plugin layer (uninstall + marketplace remove) + skills layer (uninstall kit-managed skills no longer declared in `SoT/.agents/skills.txt`; user-installed skills are never touched) | Removed a plugin or skill slug from SoT and want it gone from the machine; cleaning up extra marketplaces; reconciling kit-managed installs |
| `--force --remove-plugins` | All three layers, kit-owned scope | Full reset to SoT's declared scope — bringing a divergent machine fully in line without trampling user-only additions |

Before running either, diff first:

```bash
# Settings layer (--force preview)
diff <(jq -S . SoT/.claude/settings.json) <(jq -S . ~/.claude/settings.json)

# Plugin layer (--remove-plugins preview)
diff <(jq -rS '.enabledPlugins | keys[]' SoT/.claude/settings.json) \
     <(jq -rS '.plugins | keys[]' ~/.claude/plugins/installed_plugins.json)
diff <(jq -rS '.extraKnownMarketplaces | keys[]' SoT/.claude/settings.json) \
     <(jq -rS 'keys[]' ~/.claude/plugins/known_marketplaces.json | grep -v '^claude-plugins-official$')

./sync.sh --force --remove-plugins
```

User-added permissions arrays are discarded by `--force` (kit owns the permission model); user-added plugins and kit-managed skills missing from SoT are discarded by `--remove-plugins`. User-only top-level settings (custom env vars, mcpServers, theme overrides) and user-installed skills (not in `SoT/.agents/skills.txt`) are preserved — the kit only reconciles what it declares. If you want a locally-added permission or plugin to survive, add it to the SoT first.

#### Deploy-time modifiers: `--fable` and `--permissive`

Unlike `--force`/`--remove-plugins` (which reconcile toward SoT), these two flags push the **deployed** `~/.claude/settings.json` *away* from SoT for a specific machine profile. The SoT is never touched, and a later flag-less sync reverts both (the repo-wins merge restores the SoT compact window; the array union re-adds the SoT ask/deny entries) — re-pass the flag on machines that should keep the override. Both run after the settings merge (`claude::sync_fable` / `claude::sync_permissive` in `lib/claude.sh`), are idempotent, and honor `--dry-run`.

| Flag | Changes (deployed only) | Use when |
|------|-------------------------|----------|
| `--fable` | `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW` → `1000000` | **Disposable containers/sandboxes** where `model: best` resolves to Fable 5 — never host machines, which stay on the SoT's 468K cap (the observed fidelity ceiling for interactive host sessions). Fable 5's headline improvement is long-horizon retention — at 1M tokens the Mythos/Fable class scores 79.4 F1 on GraphWalks BFS vs Opus 4.8's 68.1 — so in a container running long autonomous work the cap would discard the capability the model buys. The flag does **not** select the model — only the compact trigger. Don't pass it on Opus-fallback machines: there the wider window just means later, lossier compactions |
| `--permissive` | `permissions.ask` → `[]`, `permissions.deny` → `[]` | Disposable sandboxes/containers where prompts stall autonomous work. `git push` drops out of `ask` and is covered by the existing `Bash(git *)` allow rule, so commits and pushes run unattended. **Never on a host machine** — the deny list (secrets reads, `sudo`, force-push to main) is the kit's safety floor; emptying it is only acceptable where the blast radius is the container |

#### Pruning stale artifacts (the `removed` manifest)

Default sync is additive, so anything the kit *stops* shipping (a deprecated hook, a settings key it no longer sets) would otherwise linger forever on an already-synced machine — the jq merge keeps user-only keys and `cp -R` never deletes. To clean those up, `lib/claude.sh` carries a declarative **`removed` manifest** (`claude::_removed_manifest`) that `claude::sync_removals` prunes on **every** sync:

| Category | Removes |
|----------|---------|
| `hooks` | hook scripts under `~/.claude/hooks/` (the matching `settings.json` hook entry is already dropped by the merge, which replaces `.hooks` wholesale) |
| `files` | other paths under `~/.claude/` |
| `settingsKeys` | dotted key paths `del()`-ed from `~/.claude/settings.json` |
| `claudeJsonKeys` | dotted key paths `del()`-ed from `~/.claude.json` |

This is a **narrow, deliberate exception** to "additive by default": entries are force-removed from every synced machine, so the manifest lists **only kit-owned keys** the kit used to set and has since dropped — pruned from the kit-managed `settings.json`. A deliberate per-machine override of any of these belongs in **`settings.local.json`**, which sync never touches; never list a key the kit never owned (a user's custom env vars, `mcpServers`, theme), which the additive merge already preserves. All removals are idempotent (`rm -f`; `delpaths` ignores absent paths) and honor `--dry-run`. Current manifest: the dead `disable-claudeai-connectors.sh` hook; `showTurnDuration` (schema-invalid in `settings.json`; sync writes it to `~/.claude.json`); `advisorModel` (dropped 2026-06-11 — the server-side advisor tool was misbehaving in practice; re-enable per-machine in `settings.local.json` if wanted); and stale env vars from older kit versions — `CLAUDE_CODE_SUBAGENT_MODEL` (the kit now relies on per-agent frontmatter), `ANTHROPIC_DEFAULT_OPUS_MODEL` (de-pinned), `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (superseded by `CLAUDE_CODE_AUTO_COMPACT_WINDOW`), `CLAUDE_CODE_DISABLE_1M_CONTEXT` (1M now enabled), `CLAUDE_CODE_FORK_SUBAGENT` (`/fork` enabled by default since 2.1.161), and `CLAUDE_CODE_EFFORT_LEVEL` (moved to the `effortLevel` settings key so skill/subagent `effort:` frontmatter isn't overridden). Add a newly-deprecated artifact by editing `claude::_removed_manifest`.

### Troubleshooting

- **RTK hook not firing in a project** — project-level PreToolUse hooks completely replace global ones. If a project has its own `.claude/settings.json` with PreToolUse hooks, the global RTK hook is silently disabled for that project. Fix: add the RTK hook entry to the project's settings (and ensure the hook command uses an absolute path, not `~/`).
- **Status line showing stale usage data** — the Stop hook fetches usage asynchronously and caches to `/tmp/.claude_usage_cache`. If it goes stale: `rm /tmp/.claude_usage_cache`.
- **Auto-compact firing at the wrong time** — the kit sets `CLAUDE_CODE_AUTO_COMPACT_WINDOW=468000` (compaction at ~95% → ~445K). To delay (containers only), pass `./sync.sh --claude --fable` or raise the value; to fire earlier, lower it or add `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=N` **in `settings.local.json`** (the `removed` manifest prunes it from the kit-managed `settings.json`). Both env vars at https://code.claude.com/docs/en/env-vars.
- **Schema validation warnings on settings.json** — `showTurnDuration` belongs in `~/.claude.json`, not `settings.json`. `sync.sh` writes it to the right file, and the `removed` manifest prunes any stale `showTurnDuration` from `settings.json` on every sync.
- **Subagent rejected by SubagentStop hook** — the hook expects file:line references. Verifiers returning "no issues found" / mode-selection responses are whitelisted. If a legitimate reply is still being rejected, extend the exception pattern in the hook command.
- **Fable session silently running on Opus** — Fable 5's safety classifiers flagged a message and auto-switched the session to Opus 4.8 (`switchModelsOnFlag`). Check the status line model name; `/model fable` to return. `claude --safe-mode` isolates whether kit customizations trip the first-request flag.
- **`@RTK.md` import missing** — generated by `rtk init -g`. If RTK is not installed, run `./sync.sh --no-rtk` to strip the import cleanly.
- **`/plugin marketplace add DocksDocks/docks` fails with "marketplace.json not found"** — clear the partial cache: `/plugin marketplace remove DocksDocks-docks` then re-add.
- **Plugin commands not appearing after install** — run `/reload-plugins`. Commands are namespaced as `/docks:<name>` (e.g., `/docks:security`).

### Plans

Multi-commit work-item plans live under `docs/plans/` (active convention; see `AGENTS.md` § Plans for the cross-tool description). The Claude Code interface is the `plan-manager` agent invoked via `/docks:plan`: it reads plans, evaluates schedule triggers, and dispatches to the assignee agent named in each plan's frontmatter.

### Open Concerns

Living list of kit-level bugs, blockers, and wait-on-upstream items that can't be fixed locally. Each entry records the symptom, root cause, workaround, and how to verify resolution.

**When invoked via "check open concerns"** (or similar), the assistant should: (a) read this section, (b) for each entry, fetch the linked upstream references and the current Claude Code version, (c) report which concerns are now resolved (issues closed/merged, version shipped), and (d) offer to remove resolved entries + undo their workarounds.

Entry format: `#### [YYYY-MM-DD] <short title>` with Status / Symptom / Root cause / Upstream / Workaround / Verify resolution / Fallback.

---

#### [2026-04-24] Opus 4.7+/4.8/Fable 5 thinking summaries not rendered

**Status:** Open — confirmed bug, no fix in Claude Code 2.1.170 (latest, last verified 2026-06-10; root-cause issue #49268 re-verified OPEN). Carries forward to Opus 4.8 (released 2026-05-28) and applies to Fable 5 (released 2026-06-09): `thinking.display` defaults to `omitted` there too, and Fable never returns raw CoT.

**Symptom:** `"showThinkingSummaries": true` in `settings.json` does not produce visible thinking content on Opus 4.7 or 4.8. The thinking block header (token count, elapsed time) renders, but the expand toggle reveals empty content.

**Root cause:** Opus 4.7 flipped the API default for `thinking.display` from `"summarized"` (4.6 behavior) to `"omitted"` (faster time-to-first-token on streaming); 4.8 inherits this default. Claude Code's harness does NOT currently translate `showThinkingSummaries: true` into `"display": "summarized"` on 4.7+/4.8 requests, so the client receives empty thinking blocks and has nothing to render.

**Upstream issues** (status re-checked 2026-05-29):
- [anthropics/claude-code#49268](https://github.com/anthropics/claude-code/issues/49268) — "harness doesn't set display: summarized" (root cause, **OPEN**)
- [anthropics/claude-code#49708](https://github.com/anthropics/claude-code/issues/49708) — thinking empty despite `showThinkingSummaries: true` (closed 2026-04-17 as duplicate of #49268, no code fix)
- [anthropics/claude-code#49322](https://github.com/anthropics/claude-code/issues/49322) — VS Code extension variant (**OPEN**)
- [anthropics/claude-code#49902](https://github.com/anthropics/claude-code/issues/49902) — VS Code extension 2.1.112 (**OPEN**)
- [anthropics/claude-code#52376](https://github.com/anthropics/claude-code/issues/52376) — feature request for subscription sessions to honor `thinking.display` (closed 2026-04-27 as duplicate of #49268; no code fix shipped — tracked under root cause)
- Model-side reference: [What's new in Claude Opus 4.8](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-8)

**Workaround:** Launch Claude Code with the hidden flag `--thinking-display summarized` (added in 2.1.111, not shown in `--help`; still required on 2.1.170). Persistent via shell alias in `~/.bashrc` or `~/.zshrc`:

```bash
alias claude='claude --thinking-display summarized'
```

**Verify resolution:**
1. Check each linked issue — look for `closed` with "merged" or a release tag citing the fix.
2. `claude update` then `claude --version`.
3. Remove the shell alias, restart shell, start a fresh session.
4. Ask a non-trivial question that triggers adaptive reasoning; confirm thinking summary renders inline.
5. If rendered: remove this Open Concerns entry + the shell alias.

**Fallback if the flag doesn't help:** The closed-as-dup [#52376](https://github.com/anthropics/claude-code/issues/52376) describes a related subscription-side concern — on Max/Team/Enterprise, the server may silently ignore `display: "summarized"` even when the client sends it (only API-key sessions are documented to honor it). It was rolled into #49268 without an independent fix. If the alias doesn't work, switch to `/model claude-opus-4-6` temporarily; thinking renders correctly on 4.6.

---

#### [2026-06-08] claude.ai account connectors auto-load into every session

**Status:** Workaround found + automated (2026-06-08). `ENABLE_CLAUDEAI_MCP_SERVERS=false` exported as a real **shell** env var disables all claude.ai cloud connectors; `sync.sh` now ensures it (`claude::sync_connector_env`). Residual gap (still Open): no settings.json key, no per-connector or per-surface (Code-vs-Chat) control — those feature requests remain unresolved.

**Symptom:** Every connector enabled in the Claude.ai web/desktop app (Figma, Google Drive, Gmail, Notion, …) OAuth-syncs into *every* Claude Code session and loads its tool definitions + system instructions into context — even connectors you never call (~100K tokens of silent bloat). They reappear on every restart and ignore per-project intent.

**Root cause:** claude.ai account connectors sync via the authenticated login and load at session start before local config is consulted. The toggle the kit long assumed was "broken" — `ENABLE_CLAUDEAI_MCP_SERVERS` — actually **works as a real shell env var** (the official MCP docs prescribe `ENABLE_CLAUDEAI_MCP_SERVERS=false claude`); it's inert *only* when placed in the settings.json `env` block, which Claude Code applies too late. `permissions.deny: ["mcp__claude_ai_*"]` blocks tool *calls* but not loading. `disabledMcpServers`/`disabledMcpjsonServers` gate only `.mcp.json`/`claude mcp add` servers, **not** cloud connectors — so the old hook's approach never worked. There is **no `disabledCloudMcpServers` key** (absent from the official schema); `allowAllClaudeAiMcps` is managed-only.

**Upstream issues** (checked 2026-06-08 via web search; none resolved):
- [anthropics/claude-code#50062](https://github.com/anthropics/claude-code/issues/50062) — ~100K tokens of silent context bloat, no per-environment opt-out (**OPEN**)
- [anthropics/claude-code#20412](https://github.com/anthropics/claude-code/issues/20412) — auto-injected without opt-in, OOM on constrained systems (**OPEN**)
- [anthropics/claude-code#45158](https://github.com/anthropics/claude-code/issues/45158) — [FEATURE] disable at project level (**OPEN**)
- [anthropics/claude-code#58453](https://github.com/anthropics/claude-code/issues/58453) — allow disabling from Claude Code settings (**OPEN**)
- [anthropics/claude-code#22301](https://github.com/anthropics/claude-code/issues/22301) — add setting to disable cloud connectors (**OPEN**)
- [anthropics/claude-code#47881](https://github.com/anthropics/claude-code/issues/47881) — disable per surface (Code vs Chat) (**OPEN**)
- Partial upstream relief: v2.1.139 disables claude.ai connectors when `ANTHROPIC_API_KEY` / `apiKeyHelper` / `ANTHROPIC_AUTH_TOKEN` is set — unusable on a Max-subscription login.

**Workaround (working, automated):** Export `ENABLE_CLAUDEAI_MCP_SERVERS=false` as a real shell env var — NOT in settings.json `env` (inert there). `sync.sh` does this via `claude::sync_connector_env`, appending it to `~/.zshrc` (zsh) / `~/.bashrc` (bash) / `~/.profile` (idempotent; never clobbers an existing value — set it to `true` yourself to keep connectors). Surgical: disables only claude.ai connectors (MCP source #5); local/project/user/plugin servers (supabase, n8n, `.mcp.json`) are untouched. Verify in a **new shell**: `/mcp` should show an empty claude.ai section while plugin servers remain. **Guaranteed fallback** if the env var is flaky on your build: `claude --strict-mcp-config --mcp-config <file>` loads only the listed servers and ignores every other source (cloud connectors included) — all-or-nothing, so re-declare any local/plugin servers you want.

The old `disable-claudeai-connectors.sh` hook + its SessionStart entry (which patched `disabledMcpServers`, a field that does NOT gate cloud connectors) were non-functional and have been **removed** — the `ENABLE_CLAUDEAI_MCP_SERVERS` shell export replaces them. (`sync.sh` copies hooks without deleting, so a previously-synced copy at `~/.claude/hooks/disable-claudeai-connectors.sh` lingers harmlessly until manually deleted.)

**Verify resolution (residual gap):** When Claude Code ships a native settings.json / per-connector / per-surface toggle (watch the linked issues), set it in SoT, `./sync.sh`, confirm `/mcp` is clean, then drop the `claude::sync_connector_env` shell-rc edit and this entry.

**Fallback (nuclear):** Disconnect connectors at claude.ai → Settings → Connected apps (removes them everywhere, including Claude.ai chat). Or authenticate with `ANTHROPIC_API_KEY` (disables all connectors per v2.1.139, but bypasses the Max subscription).
