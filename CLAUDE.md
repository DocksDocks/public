@AGENTS.md

## Claude Code

Configuration specific to Claude Code. `SoT/.claude/` is the Single Source of Truth that gets synced to `~/.claude/` by `./docks-kit sync`. Edit files in `SoT/.claude/` here in the repo, then run sync — never edit `~/.claude/` directly. The skills, commands, and multi-agent pipeline ship as a separate plugin: **[DocksDocks/docks](https://github.com/DocksDocks/docks)**.

### Repository structure (Claude-specific)

| Path | Purpose |
|------|---------|
| `SoT/.claude/CLAUDE.md` | Coding standards and conventions (synced to `~/.claude/CLAUDE.md`) |
| `SoT/.claude/settings.json` | Permissions, plugins, env vars, token limits, and sentinel-bearing runtime settings template |
| `SoT/.claude/bin/` | Dependency-free Bun programs materialized into `~/.claude/bin/` for statusline, SessionStart, and Notification |
| `SoT/.claude/mcp-servers.json` | User-scoped MCP server definitions merged into `~/.claude.json` by `claude::sync_claude_json` (settings.json can't hold `mcpServers`) |

### Plugins

Configured in `SoT/.claude/settings.json` under `enabledPlugins` and `extraKnownMarketplaces`.

| Plugin | Source | Purpose |
|--------|--------|---------|
| `docks` | [DocksDocks/docks](https://github.com/DocksDocks/docks) | Multi-agent pipeline plugin — parallel-agent slash commands (where parallel-agent value is irreducible), portable skills, and Opus/Sonnet-tiered subagents. See the plugin README for the current inventory |
| `session-relay` | [DocksDocks/docks](https://github.com/DocksDocks/docks) (same marketplace as `docks`) | Cross-session, cross-project, cross-tool agent message bus (Claude Code + Codex). A SessionStart hook auto-registers each session and drains its inbox; a `bus` MCP server exposes whoami/register/roster/send/inbox over a shared on-disk store keyed by session id; a `relay` CLI wakes an idle target with a tool-aware doorbell (headless `claude -p --resume` from the target's project dir, or `codex exec resume`). Globally enabled (`true`); Codex installs it as `session-relay@docks` via the personal marketplace file |
| `n8n-mcp-skills` | [czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills) | n8n workflow skill pack — teaches Claude Code how to author production-ready n8n workflows. **Not in the default SoT** — opt in per machine with `./docks-kit sync --claude-plugin=n8n` (adds the marketplace, installs, and enables it in deployed settings only). Kept out of the lean default so ~7 unrelated skills stay out of every project's system prompt |
| `supabase` (official) | built-in `claude-plugins-official` | Bundles two skills (`supabase` for the full product surface — Auth/Database/Edge Functions/Realtime/Storage/Vectors/Cron/Queues/Postgres extensions — and `supabase-postgres-best-practices` for Postgres performance/schema guidance) plus the `supabase` MCP server. **Not in the default SoT** — opt in per machine with `./docks-kit sync --claude-plugin=supabase` (installs + enables in deployed settings; the marketplace is built-in, so nothing extra is cloned). Kept out of the default to keep both skill descriptions + the MCP tool surface out of unrelated projects. **Account caveat:** the bundled MCP server's OAuth is account-global — see the scoping bullet below before enabling it in a repo on a different Supabase account |
| `effect-kit` | [DocksDocks/docks](https://github.com/DocksDocks/docks) (same marketplace as `docks`, at `plugins/effect-kit/`; the old standalone DocksDocks/effect-kit repo is archived) | Cross-tool Effect-TS skill kit — `effect-ts-setup` (repo bootstrap), `effect-ts-specialist` (idiomatic Effect 3.x patterns), `effect-ts-port` (Fastify/Next.js/React → Effect migration). Skills only (no agents); globally enabled (`true`). Both tools install it as `effect-kit@docks` (Codex via the personal marketplace file alongside `docks`). Optional companion CLI `effect-solutions` (Kit Langton's idiomatic-Effect docs) is auto-installed by `./docks-kit sync agents` via Bun and symlinked into `~/.local/bin` — the skills work without it. Note: effect-kit also bundles productivity skills (`context-tree`, `plan-init`, `plan-manager`, `plan-review`, `write-skill`) that duplicate docks' by name; they remain namespaced (`effect-kit:*` vs `docks:*`) but add to the skill-listing budget |

#### Per-project plugin scoping

`enabledPlugins` values carry three distinct meanings in this kit:

| Value | Meaning | `docks-kit sync --prune` |
|-------|---------|--------------------------|
| `true` | Installed + enabled in every project | keeps installed |
| `false` | Installed + globally disabled; project-level `.claude/settings.json` can flip to `true` per-repo | keeps installed |
| key absent | Not installed | uninstalls if currently installed |

Per-project enable lives in the project's `.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "a-disabled-plugin@its-marketplace": true
  }
}
```

The user-scope key MUST remain present (just `false`) — Claude Code [silently ignores](https://github.com/anthropics/claude-code/issues/27247) project-level `enabledPlugins` entries whose key is absent from user settings, so `false` is what keeps a plugin installed-but-disabled yet still per-project re-enablable. The kit currently ships **no** `false`-keyed plugins — every declared plugin is `true` — but the value stays supported for that installed-but-disabled case (the example above is illustrative). Plugins the kit doesn't want by default are dropped from the SoT entirely: the two situational ones (`supabase`, `n8n`) are opted back in per machine via `--claude-plugin=supabase` / `--claude-plugin=n8n` (see § Optional plugins), and anything else (e.g. `agent-sdk-dev`, `commit-commands`) is simply left out for the user to add manually.

Reference examples in this repo:
- `n8n-mcp-skills` is no longer in the default SoT — opt in per machine with `./docks-kit sync --claude-plugin=n8n`. Because its user-scope key is now absent, a project-level `enabledPlugins: true` alone won't activate it (the key-absent gotcha above); `--claude-plugin=n8n` is what re-adds the marketplace and the user-scope entry.
- `supabase@claude-plugins-official` is not in the default SoT. Opt in for the whole machine with `./docks-kit sync --claude-plugin=supabase`. **Account caveat** (learned 2026-07-02): the plugin's bundled MCP server is a fixed, unparameterized pointer to the hosted `https://mcp.supabase.com/mcp`, and its OAuth session holds **one Supabase account at a time, account-wide** — the plugin toggle controls whether the tools load, never which account they act on. `--claude-plugin=supabase` therefore fits only while every repo you use it in shares the same Supabase account. A repo on a different account — or one that wants project-scoped tools, read-only enforcement, or headless PAT auth — should skip the flag and check in its own `.mcp.json` pinning `https://mcp.supabase.com/mcp?project_ref=<ref>` (optionally `&read_only=true`) with `"Authorization": "Bearer ${SUPABASE_ACCESS_TOKEN_<ALIAS>}"` — one PAT env var per account, stored in a `0600` secrets file sourced by the shell rc, never committed. General rule: **a plugin bundling an MCP server with account-level auth only fits the tri-state pattern when all projects share one account**; otherwise pin per-repo `.mcp.json` entries and vendor the skills you need (the supabase skills are MIT, Supabase-authored — use the vendored-skill `upstream:` convention). Don't reference the upstream `supabase/agent-skills` marketplace — the postgres skill is bundled inside the official `supabase` plugin, and pointing at an unregistered marketplace produces a stale "Plugin not found" warning in `/doctor`.

#### Install plugins on a new machine

`./docks-kit sync` handles this automatically. After the settings merge it reads `extraKnownMarketplaces` and `enabledPlugins` from the SoT and runs `claude plugin marketplace add` for anything missing from `~/.claude/plugins/known_marketplaces.json` and `claude plugin install` for anything lacking a **user-scope** record in `installed_plugins.json` (records are per-scope arrays on Claude Code ≥2.1.198; a project-scope install elsewhere doesn't count). Both CLI commands are idempotent, so reruns are no-ops.

The bootstrap exists because **`extraKnownMarketplaces` declarations in settings.json are not auto-cloned**. Without it, `/reload-plugins` reports `Plugin <X> not found in marketplace <Y>` even though the marketplace block is present in settings.json. Adding a new third-party plugin? Add it to both `enabledPlugins` and `extraKnownMarketplaces` in `SoT/.claude/settings.json`, then run `./docks-kit sync`. To pick up the new plugin in an active session, run `/reload-plugins`.

Official plugins live in the built-in `claude-plugins-official` marketplace but load only when enabled — an absent key means **not installed** (like the ~12 unused LSP plugins in that marketplace: `clangd-lsp`, `gopls-lsp`, `pyright-lsp`, …), not on-by-default. Kept `true`: `context7`, `frontend-design`, `php-lsp`, `typescript-lsp`. `agent-sdk-dev`, `commit-commands`, and `supabase` are dropped from the SoT entirely — an absent key isn't installed on a fresh machine, so removal (not `false`) is all it takes to keep them off. Only `supabase` has an opt-in flag (`--claude-plugin=supabase`, see § Optional plugins); the other two are left for the user to add back manually if wanted. Caveat for a machine that *already* deployed one: the additive settings merge keeps a previously-deployed entry after its key vanishes from SoT, so removing the key alone won't uninstall it on an existing machine — run `./docks-kit sync --prune` to purge. `claude-md-management` and `skill-creator` are deliberately absent — the docks plugin's skill-authoring surface (`docks:write-skill`, `docks:skill-maintenance`) covers them; `code-simplifier` was dropped as unused.

The two LSP plugins (`php-lsp`, `typescript-lsp`) carry no skill or context cost — their `lspServers` config ships in the marketplace manifest (the plugin dirs on GitHub contain only a README; that's expected, not a broken install) and registers go-to-definition / find-references / post-edit diagnostics for `.php` and `.ts`/`.tsx`/`.js`/`.jsx` files. They are a no-op until the language-server binary is on PATH — `./docks-kit sync claude` auto-installs the missing ones (`claude::sync_lsp_servers`: `npm install -g intelephense typescript-language-server typescript`; warns and skips when npm itself is absent). nvm-based installs are only on the PATH of interactive shells, which covers normally-launched Claude Code sessions but not headless/cron agents.

**Manual fallback** (only if the `claude` CLI isn't on PATH during sync — sync prints a warning and skips bootstrap):

```bash
/plugin marketplace add DocksDocks/docks
/plugin install docks@docks
/reload-plugins
```

### MCP Servers

MCP server *definitions* cannot live in `settings.json` — the schema rejects an `mcpServers` key (only the control keys `enabledMcpjsonServers` / `disabledMcpjsonServers` / `enableAllProjectMcpServers` are valid there). User-scoped servers live in `~/.claude.json`; project-scoped ones in a checked-in `.mcp.json`.

The kit declares **user-scoped** MCP servers in `SoT/.claude/mcp-servers.json`, and `claude::sync_claude_json` merges them into `~/.claude.json` alongside `showTurnDuration`. The merge is **additive** — `(.mcpServers // {}) * <SoT>` — so a server you add manually survives and SoT wins per server key. Like every other sync layer, dropping a server from the SoT file does NOT remove it from `~/.claude.json` (additive by default; delete it there by hand or add it to the `removed` manifest's `claudeJsonKeys`).

| Server | Source | Purpose |
|--------|--------|---------|
| `chrome-devtools` | `ChromeDevTools/chrome-devtools-mcp` (official Google Chrome team), launched via `npx -y chrome-devtools-mcp@latest` | Deep browser debugging the `agent-browser` CLI can't do: performance traces, Lighthouse audits, network/console inspection, heap snapshots. The `-y` flag stops a first-run `npx` install prompt from hanging the stdio launch. |

**Relationship to `agent-browser`:** complementary, not redundant. `agent-browser` (CLI skill, lazy-loaded, idle-zero, lean per-op responses) is the default path for automation, scraping, form-filling, and parallel multi-session work; `chrome-devtools` MCP is the specialist for perf/Lighthouse/heap/network debugging. Both stay cheap to keep enabled because Claude Code's **Tool Search** (default-on) defers MCP tool schemas until invoked — the ~40 chrome-devtools tool definitions are not loaded into context at session start (confirmed: they surface only via the on-demand schema fetch, not the cached prefix).

### RTK (Rust Token Killer)

Token-optimized CLI proxy that reduces LLM token consumption by 60-90%. A PreToolUse hook transparently rewrites Bash commands (e.g., `git status` → `rtk git status`) so output is compressed before it reaches the context window.

*Verified working: **rtk 0.43.0** ([release notes](https://github.com/rtk-ai/rtk/releases/tag/v0.43.0), 2026-07-02). Upgrade rationale and supply-chain notes live in commit messages; only the current verified version is recorded here.* RTK versions are now gated by `SoT/toolchain.json` (verified pin 0.43.0) — upgrades above the pin prompt; bump `verified` after testing a release.

`rtk init -g` generates `~/.claude/RTK.md` and the `@RTK.md` import in `~/.claude/CLAUDE.md`. The PreToolUse hook entry comes from this kit's SoT (`SoT/.claude/settings.json`) — the command is `rtk hook claude` (direct, no shim script). RTK 0.38.0 dropped the previous `~/.claude/hooks/rtk-rewrite.sh` shim; older docs that mention it are stale.

<constraint>
**RTK upgrade gotcha** — `rtk init -g` rewrites `~/.claude/settings.json` and **clears `hooks.PreToolUse` to `[]` even when its "Patch existing settings.json? [y/N]" prompt defaults to N** (observed RTK 0.38.0, 2026-05-05). It prints a "MANUAL STEP: add this hook" message after destroying the existing one. Never run `rtk init -g` blindly during an upgrade — either snapshot `~/.claude/settings.json` first and restore the `PreToolUse` block after, or just re-run `./docks-kit sync claude --reconcile` to redeploy the SoT entry. The kit's engine skips `rtk init -g` when `~/.claude/RTK.md` already exists, so it won't trip on routine syncs — only manual invocations.
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

# 2. Initialize RTK globally (generates hook + configures Claude Code)
rtk init --global

# 3. Add "Bash(rtk:*)" to permissions.allow in ~/.claude/settings.json

# 4. Verify
rtk --version        # Should print version
rtk ls .             # Should show compressed output
rtk gain             # Should show tracking is active

# 5. Restart Claude Code for the hook to take effect
```

### Status Line

Single-line display: `model | folder • branch | ctx X% (Xk/Xk) | 5h X% (reset) • 7d X% (reset)`. The branch, context, and each quota window degrade independently when their source field is unavailable. Claude's native `rate_limits` input is the only quota source, so API-key/unsupported-plan/pre-first-response sessions simply omit the 5h/7d segment.

`./docks-kit sync claude` deploys `~/.claude/bin/statusline.mjs` and materializes an absolute Bun command with a missing-file guard. It has no jq/curl/OAuth credential/cache dependency and no Stop hook. If Bun cannot be resolved or bootstrapped during sync, the runtime cutover is deferred and existing legacy hook/statusline pointers and files are preserved. If Bun is later deleted after a successful cutover, the guarded statusline is a silent no-op and direct hooks recover on the next sync.

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

- **SessionStart**: Direct Bun exec of `~/.claude/bin/session-start.mjs`; injects current date/time and active config (context window, compact-window cap, effort level, thinking mode, subagent model) so agents don't rely on training data cutoff
- **Claude.ai connector disable** — handled by `ENABLE_CLAUDEAI_MCP_SERVERS=false` exported in your shell rc, which `./docks-kit sync` adds via `claude::sync_connector_env` (idempotent; surgical — only claude.ai cloud connectors, MCP source #5, are disabled; plugin/project servers like supabase/n8n are untouched). The old `disable-claudeai-connectors.sh` SessionStart hook — which patched `disabledMcpServers`, a field that does *not* gate account-synced connectors — was non-functional and has been **removed**. See Open Concern [2026-06-08]
- **Notification**: Direct Bun exec of `~/.claude/bin/notify.mjs`; plays `notification.mp3` via the first available native player when a task completes
- **PreToolUse (Bash)**: RTK hook rewrites commands for token-compressed output
- **SubagentStop**: Blocks subagent completion if output lacks concrete `file:line` references (allows "no issues found" / mode-selection responses through)

### Environment Variables

All configured in `SoT/.claude/settings.json` under the `env` block. The centerpiece strategy is **`model: fable` + advisor off by default + 468K compact window (`--claude-compact-window=680k` raises it to 680K for disposable containers) + high effort + per-agent-tiered subagents** — ceiling-level reasoning with the compact trigger as the per-machine knob; capability first, token cost second. Machines that benefit from advisor can opt in with `--claude-advisor=on`, which pairs the Fable main with a Fable advisor.

#### Context management

| Variable | Value | Purpose |
|----------|-------|---------|
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | `468000` | Cap the effective window at 468K; full autocompact fires at the default ~95% → ~445K. Raised from the Opus-era 350K on 2026-06-10: Fable 5's resolution holds well to ~468K in observed host-machine sessions, so the earlier cap was discarding usable retention. Context rot still applies (**rot is gradual and continuous, steepest early; the exact slope is task-dependent** — the Chroma study found Claude decays slowest of all models, measured on Opus 4 / Sonnet 4); 1M stays enabled as headroom — rot tracks tokens *used*, not window size. The `./docks-kit sync claude --claude-compact-window=680k` override raises the deployed window to 680K for disposable containers only, never host machines. Docs: https://code.claude.com/docs/en/env-vars, https://research.trychroma.com/context-rot. |
| (implicit) 1M context | enabled by default | `CLAUDE_CODE_DISABLE_1M_CONTEXT` is **not** set, so 1M is active on Max/Team/Enterprise plans for Fable 5 / Opus 4.7+. Note: 4.7 introduced a new tokenizer that may consume up to 1.35× more tokens than 4.6 on the same text (carried forward in 4.8) — a reason to keep the compact window in absolute tokens rather than as a percentage. |

The status bar keeps showing context usage against the model's full window (1M); `CLAUDE_CODE_AUTO_COMPACT_WINDOW` decouples the compact trigger from `used_percentage`. Intentional: you still see real consumption; compaction just fires earlier.

#### Thinking & reasoning

Opus 4.7 removed `budget_tokens` (returns 400 error) and makes **adaptive thinking the only thinking-on mode**; 4.8 inherits this. Fixed budgets and `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` are gone.

| Variable | Value | Purpose |
|----------|-------|---------|
| `effortLevel` (top-level key, NOT the env var) | `high` | Valid persisted values: `low`/`medium`/`high`/`xhigh`. The kit follows Fable 5's `high` default; `--claude-effort=<level>` is the per-machine override and `default` restores `high`. **Deliberately the settings key, not `CLAUDE_CODE_EFFORT_LEVEL`**: the env var is priority 1 in effort resolution and overrides per-skill/per-subagent `effort:` frontmatter (added 2.1.78–2.1.80), which would kill plugin-declared effort tiering — the settings key sets the session baseline while frontmatter wins when a skill/agent is active. `max` is session-only through `/effort`, not part of the persisted settings enum. Model-transition quirk: a new model's first run may reset settings-level effort to the model default — sync re-asserts the SoT value; confirm with `/effort`. |

#### Model selection

The kit sets **`"model": "fable"`** and leaves `advisorModel` unset: Fable 5 runs the main thread everywhere, while advisor is an explicit per-machine choice. `./docks-kit sync claude --claude-advisor=on` writes `advisorModel: fable`; `off` and `default` delete it, and a flag-less sync removes the former kit-owned advisor key from older deployments. Fable-main + Fable-advisor is accepted; advisor needs Fable org access + Claude Code ≥2.1.170. Use `./docks-kit model claude opus` or `--claude-model=opus` for a temporary Opus-main machine profile; a flag-less sync returns to Fable. `ANTHROPIC_DEFAULT_OPUS_MODEL` stays unpinned so an explicit `opus` override auto-tracks new Opus releases; to pin during a known-bad release, set it in `settings.local.json`.

**Fable classifier fallback:** Fable 5's cyber/bio safety classifiers auto-switch a flagged session to Opus 4.8 (toggle: `/config` → "switch models when a message is flagged", the `switchModelsOnFlag` key); the session stays on Opus until `/model fable`. `claude --safe-mode` (2.1.169) starts with all customizations off to isolate whether kit config trips a first-request flag.

**Subagent model selection:** not an env var. The docks plugin declares per-agent `model:` (sonnet/opus) in each agent's frontmatter. `CLAUDE_CODE_SUBAGENT_MODEL` is intentionally NOT set — it would override all per-agent declarations (it's priority 1 in Claude Code's resolution order per the [subagents doc](https://code.claude.com/docs/en/sub-agents#choose-a-model)) and block per-phase tiering. To force all subagents to one model temporarily (rollback), export `CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-4-6` — it wins over agent frontmatter.

**No `fallbackModel`:** the kit stays on the SoT-pinned model for the whole main thread. `fallbackModel` (v2.1.166+; accepts a chain of up to 3 models, now turn-scoped — the next message retries the primary, bounding the cache cost to one turn) would degrade to a lesser model on an overload (529) rather than dropping the turn. The stance is softer than it was, but retained: a silent quality dip mid-task is worse than a retried turn. Sonnet subagents are spawned deliberately via agent frontmatter, not as a fallback. To opt in per-machine during a known-bad-availability stretch, set `fallbackModel` in `~/.claude/settings.local.json`.

#### Output & UI

| Variable | Value | Purpose |
|----------|-------|---------|
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | `64000` | Max output tokens per response for the main session. A higher cap *reduces the effective input context before auto-compaction* (per the env-vars doc), so the earlier 96K bump traded input headroom for output sizes coding turns rarely reach. Subagents are capped at 32K regardless, so this main-thread value never affected synthesis-tier output (the original reason for the bump). Raise only if real outputs truncate. |
| `CLAUDE_CODE_NO_FLICKER` | `1` | Fullscreen rendering mode, no terminal flicker, adds mouse support. Requires v2.1.89+. |
| `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR` | `1` | Keeps bash commands in the project working directory instead of resetting between calls. |

#### Top-level settings.json keys

| Key | Value | Notes |
|-----|-------|-------|
| `model` | `fable` | Fable 5 alias pin. Needs Fable org access + Claude Code ≥2.1.170; use the model modifier for a per-machine Opus fallback. |
| `advisorModel` | absent (off) | Advisor is opt-in via `--claude-advisor=on` (`fable`). The removed manifest prunes the formerly kit-owned key on flag-less sync; explicit `off`/`default` also delete it. |
| `effortLevel` | `high` | See § Thinking & reasoning — Fable's default, pinned as a settings key so plugin `effort:` frontmatter still applies. |
| `autoMemoryEnabled` | `true` | Explicit pin of the default: Claude writes per-repo notes to `~/.claude/projects/<project>/memory/` (first 200 lines / 25KB of MEMORY.md auto-loads each session; topic files load on demand). Pinned so a stray disable can't drift in — cross-session recall backs the prompt files' running-notes rule. |
| `skillListingMaxDescChars` | `2048` | Per-skill description char cap in the skill listing (default 1536). Several docks/effect-kit CSO descriptions exceed 1536 and would truncate mid-trigger-condition; 2048 keeps them intact. Context budget already covered by `skillListingBudgetFraction: 0.05`. |
| `alwaysThinkingEnabled` | `true` | Tells Claude Code to opt into adaptive thinking on every turn. On 4.7, adaptive thinking is off by default at the API layer and must be explicitly enabled — this flag handles that. Moot on Fable 5 (thinking cannot be disabled there), still load-bearing on the Opus fallback. |
| `showThinkingSummaries` | `true` | Display only; doesn't reduce token use. On 4.7, thinking content is omitted by default at the API layer; Claude Code opts in when this is true. |
| `viewMode` | `default` | Default transcript view on startup. Keeps tool I/O collapsed so the feed stays readable. Press `Ctrl+O` to cycle to `verbose` on demand. Enum: `default`/`verbose`/`focus`. |
| `skipDangerousModePermissionPrompt` | `true` | Suppresses `--dangerously-skip-permissions` warning. Ignored in project-level settings for safety. |
| `skillListingBudgetFraction` | `0.05` | Cap on system-prompt budget for skill descriptions (decimal 0–1, ~5% of the model's context window). Default `0.01` was dropping ~25 descriptions; `0.025` still dropped ~22 in projects with heavier plugin stacks (e.g. `supabase` + `docks:*` forks + `claude-plugins-official`), with `/doctor` reporting ~3.4% needed. `0.05` (~50K tokens on a 1M window, ~12.5% of the 400K compact window) gives durable headroom for future skill additions and absorbs the ~7K-token opt-in cost `/doctor` cites for the dropped 22. Added in Claude Code 2.1.129+. To verify the warning is gone, run `/doctor` after sync; "Skill listing will be truncated" should not appear. |
| `minimumVersion` | `2.1.170` | Floor for auto-updates and `claude update` — a stale install upgrades to ≥2.1.170 on next launch, guaranteeing every synced machine carries the features the kit relies on (Fable 5 — incl. as the advisor — needs 2.1.170; Opus 4.8 needs 2.1.154; `skillListingBudgetFraction` needs 2.1.129). Distinct from the managed-only `requiredMinimumVersion`. |

Effort is pinned via the top-level `effortLevel` key — never `CLAUDE_CODE_EFFORT_LEVEL`, which would override per-skill/subagent `effort:` frontmatter (the `removed` manifest prunes the env var from synced machines). Use `/effort max` only as a session-scoped escalation; `max` is not a valid persisted `effortLevel`.

#### Settings that do NOT belong in settings.json

| Setting | Correct location | Notes |
|---------|-----------------|-------|
| `showTurnDuration` | `~/.claude.json` | Triggers schema validation error in settings.json. `./docks-kit sync` writes it to the right file. |

### Setup

```bash
# Clone and sync the kit
git clone <this-repo> ~/projects/public
cd ~/projects/public
./docks-kit sync                     # full sync + RTK bootstrap + plugin bootstrap (additive)
./docks-kit sync --dry-run           # preview before applying
./docks-kit sync --skip-rtk          # skip RTK install (also strips @RTK.md import from CLAUDE.md)
./docks-kit sync --yes               # auto-accept toolchain install/upgrade prompts
./docks-kit sync --reconcile         # replace ~/.claude/settings.json wholesale (settings layer only)
./docks-kit sync --prune             # uninstall plugins/marketplaces not in SoT (plugin layer only)
./docks-kit sync --reconcile --prune # full reset to SoT (both layers)
./docks-kit sync claude --claude-compact-window=680k  # deploy-time: raise autocompact window (any token count: 680k or 680000) for disposable sessions (model unchanged)
./docks-kit sync claude --claude-permissive           # deploy-time: empty permissions.ask/deny — unattended commits/pushes in sandboxes
./docks-kit sync --claude-plugin=supabase   # opt in the supabase plugin (install + enable in deployed settings)
./docks-kit sync --claude-plugin=n8n        # opt in the n8n-mcp-skills plugin (add marketplace + install + enable); repeatable/comma-separated
./docks-kit model claude opus        # deploy-time: override the Fable SoT on this machine (standalone form of --claude-model=)
./docks-kit models workflow          # list strict Docks workflow profiles, exact targets, and defaults
./docks-kit --model-reviewer=codex:gpt-5.6-terra@high --review-min-score=80  # workflow-only deployed override
./docks-kit status                   # show deployed vs SoT state
./docks-kit toolchain check          # verify installed tools against SoT/toolchain.json floors
```

In an active Claude Code session, run `/reload-plugins` after `./docks-kit sync` to activate any newly installed plugins without restarting.

The sync auto-detects the repo location, merges `settings.json` (deep-merge with array concat+unique for `permissions.{allow,deny,ask}`), writes `showTurnDuration` to `~/.claude.json`, copies the status line scripts and hook scripts, and installs/upgrades RTK via EngineNative's verified-version gate over `SoT/toolchain.json`. RTK runs first in the Claude sync pipeline, so the settings merge normalizes `rtk init`'s settings rewrite — deploy-time modifiers can no longer be clobbered.

For plugins, `./docks-kit sync` runs seven idempotent passes via the `claude plugin` CLI:

| Pass | Mode | What it does |
|------|------|--------------|
| 1 | always | `claude plugin marketplace add` for any SoT `extraKnownMarketplaces` not yet cloned |
| 2 | always | `claude plugin install` for any SoT `enabledPlugins` key (true OR false) without a **user-scope** record in `installed_plugins.json`. `false`-keyed plugins still get installed so per-project enable has something to load. Before the first install attempt, refreshes marketplace manifests once (stale-manifest guard — an already-cloned marketplace may predate a plugin later added to it, and pass 3's refresh runs too late). **Side effect:** `claude plugin install` enables the plugin at user scope (writes `"<id>": true` into `~/.claude/settings.json`), clobbering the `false` the settings merge wrote — pass 7 corrects this |
| 3 | always | `claude plugin marketplace update` (refresh manifests) |
| 4 | always | `claude plugin update <name>` for each installed plugin (idempotent — no-op when already at latest) |
| 5 | `--prune` | `claude plugin uninstall -y --scope user <name>` for installed plugins whose key is **absent** from SoT `enabledPlugins`. `false`-keyed plugins are preserved (intentionally listed as globally-disabled-but-installed); project/local-scope install records are project-owned and never touched |
| 6 | `--prune` | `claude plugin marketplace remove <name>` for marketplaces **not** in SoT `extraKnownMarketplaces` (built-in `claude-plugins-official` is never removed) |
| 7 | always | Re-assert SoT enabled-state: rewrite `~/.claude/settings.json` `enabledPlugins` so SoT-declared values win (`(.enabledPlugins // {}) * $sot`), undoing pass 2's enable side effect. Without this, every `false`-keyed third-party plugin ships globally **enabled** — defeating the per-project scoping contract. User-only `enabledPlugins` entries are preserved |

For Codex plugins, after deploying `SoT/.codex/config.toml` and the personal marketplace file, sync runs `codex plugin add <plugin@marketplace>` for each enabled SoT plugin. Re-running sync therefore refreshes stale Codex plugin caches instead of only updating marketplace metadata. Sync also removes the older kit-created configured Docks marketplace source so Codex uses the personal marketplace file as the single source.

`--reconcile` and `--prune` are orthogonal: `--reconcile` reconciles `settings.json` through the native TypeScript merge (SoT-declared keys win, `permissions.{allow,deny,ask}` arrays are replaced wholesale by SoT, user-only top-level keys and nested objects are preserved), `--prune` reconciles the plugin layer (uninstall + marketplace remove) AND the skills layer (uninstall kit-managed skills tracked in `~/.agents/.kit-managed-skills` that are no longer in `SoT/.agents/skills.txt`). Default sync is additive on all three layers — drift survives.

#### When to use `--reconcile` and `--prune`

The default merge is additive on both layers: keys present in `~/.claude/settings.json` but absent from the SoT are preserved, and installed plugins not in SoT `enabledPlugins` are kept. This protects user-only additions, but it also means **drift accumulates** — neither flag-less reset can clean it up.

| Flag | Affects | Use when |
|------|---------|----------|
| `--reconcile` | `~/.claude/settings.json` (kit-owned keys only) | Removing/renaming a settings key in SoT (env var, permission, hook); resetting after a schema warning; dropping locally-added permissions that diverged from SoT. User-only top-level keys (custom env vars, mcpServers, theme overrides) survive untouched |
| `--prune` | Plugin layer (uninstall + marketplace remove) + skills layer (uninstall kit-managed skills no longer declared in `SoT/.agents/skills.txt`; user-installed skills are never touched) | Removed a plugin or skill slug from SoT and want it gone from the machine; cleaning up extra marketplaces; reconciling kit-managed installs |
| `--reconcile --prune` | All three layers, kit-owned scope | Full reset to SoT's declared scope — bringing a divergent machine fully in line without trampling user-only additions |

Before running either, diff first:

```bash
# Settings layer (--reconcile preview)
diff <(jq -S . SoT/.claude/settings.json) <(jq -S . ~/.claude/settings.json)

# Plugin layer (--prune preview)
diff <(jq -rS '.enabledPlugins | keys[]' SoT/.claude/settings.json) \
     <(jq -rS '.plugins | keys[]' ~/.claude/plugins/installed_plugins.json)
diff <(jq -rS '.extraKnownMarketplaces | keys[]' SoT/.claude/settings.json) \
     <(jq -rS 'keys[]' ~/.claude/plugins/known_marketplaces.json | grep -v '^claude-plugins-official$')

./docks-kit sync --reconcile --prune
```

User-added permissions arrays are discarded by `--reconcile` (kit owns the permission model); user-added plugins and kit-managed skills missing from SoT are discarded by `--prune`. User-only top-level settings (custom env vars, mcpServers, theme overrides) and user-installed skills (not in `SoT/.agents/skills.txt`) are preserved — the kit only reconciles what it declares. If you want a locally-added permission or plugin to survive, add it to the SoT first.

#### Deploy-time modifiers

Unlike `--reconcile`/`--prune` (which reconcile toward SoT), modifiers change the **deployed** config for a specific machine profile. The SoT is never touched, and a later flag-less sync reasserts it: Claude returns to Fable/high/advisor-off and Codex returns to its model/high effort. Modifiers run after the base merge/removal passes, are idempotent, honor `--dry-run`, and warn when their tool target is not selected. `docks-kit model <tool> <value>` is the standalone form of the model modifiers.

| Flag | Changes (deployed only) | Use when |
|------|-------------------------|----------|
| `--claude-model=<m>` | top-level `model` (`default` deletes the key so the account default applies) | Override the Fable SoT on one machine; re-pass it after future syncs |
| `--claude-effort=<level>` | top-level `effortLevel`; `low`/`medium`/`high`/`xhigh`, with `default` → SoT `high` | Tune persisted Claude effort without using the env var that would override skill/subagent frontmatter |
| `--claude-advisor=<on\|off\|default>` | `on` writes `advisorModel: fable`; `off`/`default` delete it | Opt one machine into Fable advisor; the SoT and flag-less sync keep advisor off |
| `--claude-compact-window=<tokens>` | `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW` → the given value (any token count: `680k` or `680000`) | **Disposable containers/sandboxes** running long autonomous work — never host machines, which stay on the SoT's 468K cap (the observed fidelity ceiling for interactive host sessions). The wider 680K window lets a container retain more before compaction when the extra headroom is worth the added rot. The flag does **not** select the model — only the compact trigger. Don't pass it on host machines: there the wider window just means later, lossier compactions |
| `--claude-permissive` | `permissions.ask` → `[]`, `permissions.deny` → `[]` | Disposable sandboxes/containers where prompts stall autonomous work. The SoT `ask` list is already minimal (2026-07-08 slim-down: only `git clean` / `docker volume rm` / `docker system prune` — the local-data destroyers; everything else defers to the auto-mode classifier, since `ask` entries force prompts even in auto mode), so this flag mostly matters for emptying `deny`. **Never on a host machine** — the deny list (secrets reads, `sudo`, force-push to main) is the kit's safety floor; emptying it is only acceptable where the blast radius is the container |

Codex mirrors the model/effort contract with `--codex-model=<m>` and
`--codex-effort=<level>`; Codex `default` effort restores `high`. Fast remains
absent from the global SoT. Role-scoped Fast is expressed only by the optional
`+fast` workflow-selector suffix; an unsuffixed Codex role means Standard.

#### Docks workflow-role overrides

The five root flags `--model-orchestrator`, `--model-reviewer`,
`--model-implementer`, `--review-min-score`, and `--review-max-rounds` are a
workflow-only operation: they atomically update one identical complete
`Docks-workflow-models:` record in `~/.claude/CLAUDE.md` and
`~/.codex/AGENTS.md` without running sync. A partial invocation preserves
omitted values from the current valid record; missing parallel state is
repaired, while malformed or divergent records stop before either file changes.
A flag-less sync reasserts the SoT defaults. Start fresh Claude Code and Codex
sessions after an override so both tools load the same record.

Selectors are exactly `profile:<name>` or `<tool>:<model>@<effort>[+fast]` and
must be present in `docks-kit models workflow`; `+fast` is Codex-only and emits
a schema-2 candidate with `service_tier: "fast"`. Without the suffix, the record
stays schema 1 and the consumer must force Codex's default service tier rather
than inherit a global Fast preference. `claude:best@high` is Claude's native
single-model alias, while `profile:claude-best` is the Docks-managed ordered
Fable-high then Opus-xhigh candidate chain. Candidate availability is tested by
Docks when it launches each role—docks-kit does not preflight providers or
claim provider-wide fallback. Upgrade Docks and Session Relay to schema-2
consumer support before deploying a `+fast` selector.

#### Optional plugins: `--claude-plugin=supabase` and `--claude-plugin=n8n`

Two situational plugins are kept out of the SoT entirely and opted in per machine. Neither key is in `enabledPlugins`, so a flag-less sync installs, loads, and enables neither (an absent plugin is simply not installed). Unlike `--claude-compact-window`/`--claude-permissive`, the opt-in is **sticky**: once `--claude-plugin=<name>` installs and enables a plugin it stays until you run `--prune` — a later flag-less sync won't revert it (the SoT has no key to reassert against). The flag is repeatable and accepts comma-separated names (`--claude-plugin=supabase,n8n`); unknown names exit 2. Implemented by `claude::sync_optional_plugins`, which runs right after `claude::sync_plugins`.

| Flag | Plugin | What it does |
|------|--------|--------------|
| `--claude-plugin=supabase` | `supabase@claude-plugins-official` | Installs it (from the built-in official marketplace — no marketplace add) and enables it, machine-wide |
| `--claude-plugin=n8n` | `n8n-mcp-skills@n8n-mcp-skills` | Adds the `czlonkowski/n8n-skills` marketplace (absent from the SoT), installs the plugin, and enables it |

Without the flag neither plugin is installed, loaded, or downloaded; only `--prune` uninstalls one already present. The opt-in is **sticky** precisely because both keys are absent from the SoT: pass 7's reassert only touches SoT-declared plugins, so once a flag installs and enables one, a later flag-less sync leaves it alone.

#### Pruning stale artifacts (the `removed` manifest)

Default sync is additive, so anything the kit *stops* shipping (a deprecated hook, a settings key it no longer sets) would otherwise linger forever on an already-synced machine — the settings merge keeps user-only keys and asset copies never delete. To clean those up, EngineNative carries a declarative **`removed` manifest** that `syncRemovals` prunes on **every** sync:

| Category | Removes |
|----------|---------|
| `hooks` | hook scripts under `~/.claude/hooks/` (the matching `settings.json` hook entry is already dropped by the merge, which replaces `.hooks` wholesale) |
| `files` | other paths under `~/.claude/` |
| `settingsKeys` | dotted key paths `del()`-ed from `~/.claude/settings.json` |
| `claudeJsonKeys` | dotted key paths `del()`-ed from `~/.claude.json` |

This is a **narrow, deliberate exception** to "additive by default": entries are force-removed from every synced machine, so the manifest lists **only kit-owned keys or exact permission rules** the kit used to set and has since dropped — pruned from the kit-managed `settings.json`. A deliberate per-machine override of any of these belongs in **`settings.local.json`**, which sync never touches; never list a key or rule the kit never owned (a user's custom env vars, `mcpServers`, theme, permission), which the additive merge already preserves. All removals are idempotent and honor `--dry-run`. Current baseline entries include the dead `disable-claudeai-connectors.sh` hook, superseded `alert_bubble.mp3`, `showTurnDuration` in settings, stale kit env vars, and the four unsupported path-qualified `Write(...)` rules replaced by `Edit(...)`. A second, readiness-gated subset removes `statusline.sh`, `fetch-usage.sh`, `hooks/notify.sh`, and `hooks.Stop` only after Bun runtime assets and new settings commit successfully; deferred/failed migration preserves them. Add a newly-deprecated artifact by editing the removed manifest in `claudeSync.ts`.

### Troubleshooting

- **RTK hook not firing in a project** — project-level PreToolUse hooks completely replace global ones. If a project has its own `.claude/settings.json` with PreToolUse hooks, the global RTK hook is silently disabled for that project. Fix: add the RTK hook entry to the project's settings (and ensure the hook command uses an absolute path, not `~/`).
- **Status line missing 5h/7d usage** — Claude omits native `rate_limits` for API-key/unsupported-plan sessions and before the first API response; the statusline intentionally omits only that segment. There is no OAuth fallback or cache to clear. If the whole statusline is absent, re-run `./docks-kit sync claude` to restore Bun/runtime assets and inspect the migration warning.
- **Auto-compact firing at the wrong time** — the kit sets `CLAUDE_CODE_AUTO_COMPACT_WINDOW=468000` (compaction at ~95% → ~445K). To delay (containers only), pass `./docks-kit sync claude --claude-compact-window=680k` or raise the value; to fire earlier, lower it or add `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=N` **in `settings.local.json`** (the `removed` manifest prunes it from the kit-managed `settings.json`). Both env vars at https://code.claude.com/docs/en/env-vars.
- **Schema validation warnings on settings.json** — `showTurnDuration` belongs in `~/.claude.json`, not `settings.json`. `./docks-kit sync` writes it to the right file, and the `removed` manifest prunes any stale `showTurnDuration` from `settings.json` on every sync.
- **Subagent rejected by SubagentStop hook** — the hook expects file:line references. Verifiers returning "no issues found" / mode-selection responses are whitelisted. If a legitimate reply is still being rejected, extend the exception pattern in the hook command.
- **Fable session silently running on Opus** — Fable 5's safety classifiers flagged a message and auto-switched the session to Opus 4.8 (`switchModelsOnFlag`). Check the status line model name; `/model fable` to return. `claude --safe-mode` isolates whether kit customizations trip the first-request flag.
- **`@RTK.md` import missing** — generated by `rtk init -g`. If RTK is not installed, run `./docks-kit sync --skip-rtk` to strip the import cleanly.
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

**Status:** Workaround found + automated (2026-06-08). `ENABLE_CLAUDEAI_MCP_SERVERS=false` exported as a real **shell** env var disables all claude.ai cloud connectors; `./docks-kit sync` now ensures it (`claude::sync_connector_env`). Residual gap (still Open): no settings.json key, no per-connector or per-surface (Code-vs-Chat) control — those feature requests remain unresolved.

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

**Workaround (working, automated):** Export `ENABLE_CLAUDEAI_MCP_SERVERS=false` as a real shell env var — NOT in settings.json `env` (inert there). `./docks-kit sync` does this via `claude::sync_connector_env`, appending it to `~/.zshrc` (zsh) / `~/.bashrc` (bash) / `~/.profile` (idempotent; never clobbers an existing value — set it to `true` yourself to keep connectors). Surgical: disables only claude.ai connectors (MCP source #5); local/project/user/plugin servers (supabase, n8n, `.mcp.json`) are untouched. Verify in a **new shell**: `/mcp` should show an empty claude.ai section while plugin servers remain. **Guaranteed fallback** if the env var is flaky on your build: `claude --strict-mcp-config --mcp-config <file>` loads only the listed servers and ignores every other source (cloud connectors included) — all-or-nothing, so re-declare any local/plugin servers you want.

The old `disable-claudeai-connectors.sh` hook + its SessionStart entry (which patched `disabledMcpServers`, a field that does NOT gate cloud connectors) were non-functional and have been **removed** — the `ENABLE_CLAUDEAI_MCP_SERVERS` shell export replaces them. The sync engine's baseline removed manifest force-prunes any previously synced copy.

**Verify resolution (residual gap):** When Claude Code ships a native settings.json / per-connector / per-surface toggle (watch the linked issues), set it in SoT, `./docks-kit sync`, confirm `/mcp` is clean, then drop the `claude::sync_connector_env` shell-rc edit and this entry.

**Fallback (nuclear):** Disconnect connectors at claude.ai → Settings → Connected apps (removes them everywhere, including Claude.ai chat). Or authenticate with `ANTHROPIC_API_KEY` (disables all connectors per v2.1.139, but bypasses the Max subscription).
