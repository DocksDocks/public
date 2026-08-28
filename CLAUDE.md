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

| Default plugin | Source | Purpose |
|----------------|--------|---------|
| `docks` | [DocksDocks/docks](https://github.com/DocksDocks/docks) | Multi-agent pipeline plugin — parallel-agent slash commands, portable skills, and tiered subagents. |
| `plan-lifecycle` | [DocksDocks/docks](https://github.com/DocksDocks/docks) | Shared plan lifecycle for cross-tool planning workflows. |
| `php-lsp` | built-in `claude-plugins-official` | PHP language-server integration with no prompt or skill context. |
| `typescript-lsp` | built-in `claude-plugins-official` | TypeScript/JavaScript language-server integration with no prompt or skill context. |

For Effect work in this checkout, verify API shapes against the installed declarations under `node_modules/effect/dist/unstable/cli/`. The `effect-ts-setup`, `effect-ts-port`, and `effect-ts-specialist` skills are Effect 3.x-only and do not apply.

Context7, Frontend Design, Chrome DevTools, Supabase, and n8n are non-default. Install only where their project needs them; the default global inventory stays limited to the four entries above.

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

The user-scope key MUST remain present (just `false`) when a project wants to override a globally installed plugin's enabled state. The kit currently ships no `false`-keyed plugins — every declared default is `true`. Plugins outside the five defaults are absent from the user-scope SoT and are removed by `--prune`.

For n8n on this machine, install the marketplace and plugin directly at project scope so unrelated Claude Code sessions do not discover its skills:

```bash
cd /home/docks/projects/n8n-workflows
claude plugin marketplace add czlonkowski/n8n-skills --scope project
claude plugin install n8n-mcp-skills@n8n-mcp-skills --scope project
```

Keep `/home/docks/projects/n8n-workflows/.claude/settings.json` enabling `n8n-mcp-skills@n8n-mcp-skills`. The project-scope install is independent of the absent user-scope key and survives the kit's user-scope prune. `./docks-kit sync --claude-plugin=n8n` remains the explicit machine-wide opt-in.

OMP 17.0.2's `claude-plugins` provider does not honor Claude's `projectPath`; it exposes every project-scoped plugin unless its skills are filtered. Keep the public/global OMP surface lean with `omp config set skills.ignoredSkills '["n8n-*","using-n8n-*","supabase*"]'`, then override that array in each owning project's `.omp/config.yml`: the n8n project keeps only `supabase*` ignored, while a Supabase project keeps `n8n-*` and `using-n8n-*` ignored. Project settings replace the global array, so each project regains only its own scoped plugin skills.

Supabase is also absent from the default SoT. `./docks-kit sync --claude-plugin=supabase` enables it machine-wide only when every repo can safely share its account-global OAuth session; otherwise use a project-owned `.mcp.json`.

#### Install plugins on a new machine

`./docks-kit sync` handles this automatically. After the settings merge it reads `extraKnownMarketplaces` and `enabledPlugins` from the SoT and runs `claude plugin marketplace add` for anything missing from `~/.claude/plugins/known_marketplaces.json` and `claude plugin install` for anything lacking a **user-scope** record in `installed_plugins.json` (records are per-scope arrays on Claude Code ≥2.1.198; a project-scope install elsewhere doesn't count). Both CLI commands are idempotent, so reruns are no-ops.

The bootstrap exists because **`extraKnownMarketplaces` declarations in settings.json are not auto-cloned**. Without it, `/reload-plugins` reports `Plugin <X> not found in marketplace <Y>` even though the marketplace block is present in settings.json. Adding a new third-party plugin? Add it to both `enabledPlugins` and `extraKnownMarketplaces` in `SoT/.claude/settings.json`, then run `./docks-kit sync`. To pick up the new plugin in an active session, run `/reload-plugins`.

Official plugins live in the built-in `claude-plugins-official` marketplace but load only when enabled. The default SoT keeps only `php-lsp` and `typescript-lsp`; Context7, Frontend Design, Agent SDK, Commit Commands, Chrome DevTools, and Supabase are non-default and absent. An existing additive user installation remains until `./docks-kit sync claude --prune` removes it.

The two LSP plugins (`php-lsp`, `typescript-lsp`) carry no skill or context cost — their `lspServers` config ships in the marketplace manifest (the plugin dirs on GitHub contain only a README; that's expected, not a broken install) and registers go-to-definition / find-references / post-edit diagnostics for `.php` and `.ts`/`.tsx`/`.js`/`.jsx` files. They are a no-op until the language-server binary is on PATH — `./docks-kit sync claude` auto-installs the missing ones (`claude::sync_lsp_servers`: `npm install -g intelephense typescript-language-server typescript`; warns and skips when npm itself is absent). nvm-based installs are only on the PATH of interactive shells, which covers normally-launched Claude Code sessions but not headless/cron agents.

**Manual fallback** (only if the `claude` CLI isn't on PATH during sync — sync prints a warning and skips bootstrap):

```bash
/plugin marketplace add DocksDocks/docks
/plugin install docks@docks
/reload-plugins
```

### MCP Servers

MCP server *definitions* cannot live in `settings.json` — the schema rejects an `mcpServers` key (only the control keys `enabledMcpjsonServers` / `disabledMcpjsonServers` / `enableAllProjectMcpServers` are valid there). User-scoped servers live in `~/.claude.json`; project-scoped ones in a checked-in `.mcp.json`.

`SoT/.claude/mcp-servers.json` is intentionally empty. `claudeSync.ts syncClaudeJson` still supports additive user-scoped MCP declarations, but the kit deploys none globally; project-specific servers belong in checked-in `.mcp.json` files.

Chrome DevTools and Context7 are non-default. Add Chrome DevTools at project or user scope only for performance, network, console, or heap debugging that the project's own browser tooling cannot cover. Frontend Design is likewise an optional official plugin rather than a global default.


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

**Cutting auto-mode false positives — `autoMode.environment`:** the classifier blocks anything aimed *outside* your environment; out of the box it trusts only the working dir and the current repo's remotes. To stop it flagging routine pushes to your other org repos or writes to trusted buckets, add an `autoMode.environment` array (prose entries; include the literal `"$defaults"` to keep the built-ins) to **that checkout's `.claude/settings.local.json`** — not the shared SoT: the classifier ignores `autoMode` in checked-in project `.claude/settings.json`, and trusted-infra is checkout-specific. The block also accepts `allow`/`soft_deny`/`hard_deny` prose lists, but `permissions.deny` (which runs *before* the classifier) stays the only unbypassable gate. Inspect the effective rules with `claude auto-mode config`; critique custom rules with `claude auto-mode critique`. Docs: https://code.claude.com/docs/en/auto-mode-config.

**Fallbacks baked in**: 3 consecutive classifier blocks or 20 total in a session pause auto mode and resume prompting. Approving the prompted action resumes auto. Not configurable.

**When to bail out of auto mode**: classifier outage, sensitive production work, CI migrations, anything where you want to review each step. `Shift+Tab` cycles away from auto.

**Allow list scope.** `permissions.allow` carries five entries only: four read-only tools (`Read`, `Glob`, `Grep`, and `WebSearch`) plus `Edit(./)`, which permits edits in the working directory. The 128 shell allow rules the kit used to ship (`Bash(git *)`, `Bash(curl *)`, `Bash(docker *)`, `Bash(sed *)`, and their `PowerShell(...)` twins) pre-approved destructive variants — `git clean -fdx` matched `Bash(git *)` — and an explicit allow rule resolves *before* both Claude Code's own read-only command analyzer and the auto-mode classifier, so no review step existed for them. Claude Code already runs the safe read-only forms (`ls`, `cat`, `git status`, `git log`) with no prompt in every mode through that analyzer. The removed rules therefore bought nothing but bypass. Under the deployed `defaultMode: auto`, a non-read-only shell command now reaches the classifier; under `default` mode it prompts. `WebFetch` was dropped for the same reason: it retrieves attacker-controlled content, and the classifier is the intended reviewer for that.

**Headless runs.** A headless `claude -p` run cannot present an interactive approval prompt. If a non-read-only Bash or PowerShell call has no matching allow rule or permission mode approval, Claude Code refuses the tool call and reports the refusal to the model. The command does not run, although the model can still return text. An unattended job that needs a shell command must pass a narrow command-line rule, for example `claude -p "Run the tests" --allowedTools "Bash(npm test)"`, instead of restoring a broad SoT rule. `--allowedTools` lets matching tools execute without a prompt for that run and uses permission-rule syntax; see https://code.claude.com/docs/en/cli-reference#cli-flags.

**Why `autoMode.classifyAllShell` stays unset.** Setting it to `true` suspends every Bash and PowerShell allow rule while auto mode is active and sends every shell command to the classifier. Each command then adds a classifier call. The kit ships no shell allow rules, so this setting adds classifier traffic without closing an allow-rule bypass. See https://code.claude.com/docs/en/auto-mode-config#route-all-shell-commands-through-the-classifier.

**PowerShell rules ship on every host.** Claude Code enables the PowerShell tool automatically on Windows and leaves it opt-in on Linux, macOS, and WSL (https://code.claude.com/docs/en/tools-reference#powershell-tool). Opt-in means available, not absent, so the kit deploys its `PowerShell(...)` deny and ask rules everywhere: a machine that later enables the tool must already carry the guards. The rules are dead weight on a host that never enables PowerShell — a few hundred strings in a file Claude Code parses once per session — which is the cheaper side of the trade.

**Retired rules are force-pruned.** `settings.ts mergeSettings, permission-array union` combines the deployed arrays with the SoT arrays, so deleting a rule from the SoT never removes it from a machine an earlier sync already wrote. `claudeRetired.ts RETIRED_PERMISSION_RULES, exact retired-rule inventory` holds the strings the kit no longer ships — the 128 shell allow rules, `WebFetch`, and the 14 malformed single-backslash deny spellings — and `claudeSync.ts syncRemovals, retired-permission pass` force-prunes those exact strings from the kit-managed `~/.claude/settings.json` on every sync. A different user-authored rule survives. To restore an exact retired rule for one checkout, put it in that checkout's `.claude/settings.local.json`. Claude Code resolves that file against the working directory and merges it over user settings. Sync never reads or writes the checkout-local file. Claude Code has no user-scope local settings file. For a machine-wide restoration, add the rule to `SoT/.claude/settings.json`. At the same time, remove the exact string from `claudeRetired.ts RETIRED_PERMISSION_RULES, exact retired-rule inventory`. Retiring a shipped rule takes the opposite two edits. Delete it from the SoT. Add its exact string to the retired inventory.

**Malformed deny rules (fixed).** The kit shipped 14 deny rules whose specifier ended in a single backslash before the closing parenthesis, such as `PowerShell(rm *-Recurse* *:\)`. Claude Code's rule parser counts backslash parity, so the `\` escaped the `)` and every session start printed `Invalid permission rule … Mismatched parentheses`. The SoT now writes `\\` in those positions and the old spellings are in the retired inventory.

### Hooks

- **SessionStart**: Direct Bun exec of `~/.claude/bin/session-start.mjs`; injects current date/time and active config (context window, compact-window cap, effort level, thinking mode, subagent model) so agents don't rely on training data cutoff
- **Claude.ai connector disable** — handled by `ENABLE_CLAUDEAI_MCP_SERVERS=false` exported in your shell rc, which `./docks-kit sync` adds via `claude::sync_connector_env` (idempotent; surgical — only claude.ai cloud connectors, MCP source #5, are disabled; plugin/project servers like supabase/n8n are untouched). The old `disable-claudeai-connectors.sh` SessionStart hook — which patched `disabledMcpServers`, a field that does *not* gate account-synced connectors — was non-functional and has been **removed**. See Open Concern [2026-06-08]
- **Notification**: Direct Bun exec of `~/.claude/bin/notify.mjs`; plays `notification.mp3` via the first available native player when a task completes
- **SubagentStop**: Blocks subagent completion if output lacks concrete `file:line` references (allows "no issues found" / mode-selection responses through)

### Environment Variables

All configured in `SoT/.claude/settings.json` under the `env` block. The centerpiece strategy is **`model: opus` + advisor off by default + 468K compact window (`--claude-compact-window=680k` raises it to 680K for disposable containers) + high effort + per-agent-tiered subagents** — ceiling-level reasoning with the compact trigger as the per-machine knob; capability first, token cost second. Machines that benefit from advisor can opt in with `--claude-advisor=on`, which writes a Fable advisor alongside the Opus main.

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

The kit sets **`"model": "opus"`** and leaves `advisorModel` unset. `opus` is an alias, not a pinned id: the SoT `minimumVersion` of 2.1.219 ensures Claude Code can resolve it to the newest Opus its provider offers — Opus 5 on the Anthropic API or Opus 4.6 on Microsoft Foundry — instead of silently capping Anthropic API users at Opus 4.8 under the former 2.1.170 floor. Keeping the alias preserves provider portability and tracks future Opus releases; pinning the literal `claude-opus-5` would be unresolvable on Foundry and would freeze the selection. This floor also subsumes Fable 5's older Claude Code ≥2.1.170 requirement. Advisor stays an explicit per-machine choice: `./docks-kit sync claude --claude-advisor=on` writes `advisorModel: fable`; `off` and `default` delete it, and a flag-less sync removes the former kit-owned advisor key from older deployments. Advisor needs Fable org access + Claude Code ≥2.1.170. Use `./docks-kit model claude opus` or `--claude-model=opus` for a per-machine main-model override; `default` restores the SoT alias.

**Fable classifier fallback:** Fable 5's cyber/bio safety classifiers auto-switch a flagged session to Opus 4.8 (toggle: `/config` → "switch models when a message is flagged", the `switchModelsOnFlag` key); the session stays on Opus until `/model fable`. `claude --safe-mode` (2.1.169) starts with all customizations off to isolate whether kit config trips a first-request flag.

**Subagent model selection:** not an env var. `CLAUDE_CODE_SUBAGENT_MODEL` is intentionally NOT set — it is priority 1 in Claude Code's resolution order per the [subagents doc](https://code.claude.com/docs/en/sub-agents#choose-a-model), so it would override every per-agent declaration and block per-phase tiering. This kit's own `.claude/agents/*.md` pin `model: sonnet` deliberately; omp never reads that directory, so those pins are safe. Plugin-shipped agents are the opposite case: docks agents **omit** `model` entirely, because omp also discovers plugin `agents/` dirs and treats any literal — `inherit` included — as a model ID, killing the spawn. To force all subagents to one model temporarily (rollback), export `CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-5` — it wins over agent frontmatter.

**No `fallbackModel`:** the kit stays on the SoT-pinned model for the whole main thread. `fallbackModel` (v2.1.166+; accepts a chain of up to 3 models, now turn-scoped — the next message retries the primary, bounding the cache cost to one turn) would degrade to a lesser model on an overload (529) rather than dropping the turn. The stance is softer than it was, but retained: a silent quality dip mid-task is worse than a retried turn. Sonnet subagents are spawned deliberately via agent frontmatter, not as a fallback. To opt in per-checkout during a known-bad-availability stretch, set `fallbackModel` in that checkout's `.claude/settings.local.json`.

#### Output & UI

| Variable | Value | Purpose |
|----------|-------|---------|
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | `64000` | Max output tokens per response for the main session. A higher cap *reduces the effective input context before auto-compaction* (per the env-vars doc), so the earlier 96K bump traded input headroom for output sizes coding turns rarely reach. Subagents are capped at 32K regardless, so this main-thread value never affected synthesis-tier output (the original reason for the bump). Raise only if real outputs truncate. |
| `CLAUDE_CODE_NO_FLICKER` | `1` | Fullscreen rendering mode, no terminal flicker, adds mouse support. Requires v2.1.89+. |
| `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR` | `1` | Keeps bash commands in the project working directory instead of resetting between calls. |

#### Top-level settings.json keys

| Key | Value | Notes |
|-----|-------|-------|
| `model` | `opus` | Opus alias pin. The `minimumVersion` floor lets Claude Code resolve the alias to the newest Opus its provider offers; use the model modifier for a per-machine override. |
| `advisorModel` | absent (off) | Advisor is opt-in via `--claude-advisor=on` (`fable`). The removed manifest prunes the formerly kit-owned key on flag-less sync; explicit `off`/`default` also delete it. |
| `effortLevel` | `high` | See § Thinking & reasoning — Fable's default, pinned as a settings key so plugin `effort:` frontmatter still applies. |
| `autoMemoryEnabled` | `false` | Turns off the per-repo auto-memory writes under `~/.claude/projects/<project>/memory/`. Auto-memory injects a mutable MEMORY.md head (first 200 lines / 25KB) into the cached prompt prefix each session, which breaks the cache-invariance rule and re-injects stale notes that the prompt files and the plan issue already cover. The env twin `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` is the documented alternative and is not used, because a settings key is what `--reconcile` can reset. |
| `autoDreamEnabled` | `false` | Turns off background "dream" tasks, which Claude Code schedules between turns and bills as extra model calls. The kit spends its budget on the turn in front of the user. Key confirmed in the 2.1.251 binary; absent from the published JSON schema, whose root allows additional properties. |
| `skillListingMaxDescChars` | `2048` | Per-skill description char cap in the skill listing (default 1536). Several docks CSO descriptions exceed 1536 and would truncate mid-trigger-condition; 2048 keeps them intact. Context budget already covered by `skillListingBudgetFraction: 0.05`. |
| `alwaysThinkingEnabled` | `true` | Tells Claude Code to opt into adaptive thinking on every turn. On 4.7, adaptive thinking is off by default at the API layer and must be explicitly enabled — this flag handles that. Moot on Fable 5 (thinking cannot be disabled there), still load-bearing on the Opus fallback. |
| `showThinkingSummaries` | `true` | Display only; doesn't reduce token use. On 4.7, thinking content is omitted by default at the API layer; Claude Code opts in when this is true. |
| `viewMode` | `default` | Default transcript view on startup. Keeps tool I/O collapsed so the feed stays readable. Press `Ctrl+O` to cycle to `verbose` on demand. Enum: `default`/`verbose`/`focus`. |
| `skipDangerousModePermissionPrompt` | `true` | Suppresses `--dangerously-skip-permissions` warning. Ignored in project-level settings for safety. |
| `skillListingBudgetFraction` | `0.05` | Cap on system-prompt budget for skill descriptions (decimal 0–1, ~5% of the model's context window). Default `0.01` was dropping ~25 descriptions; `0.025` still dropped ~22 in projects with heavier plugin stacks (e.g. `supabase` + `docks:*` forks + `claude-plugins-official`), with `/doctor` reporting ~3.4% needed. `0.05` (~50K tokens on a 1M window, ~12.5% of the 400K compact window) gives durable headroom for future skill additions and absorbs the ~7K-token opt-in cost `/doctor` cites for the dropped 22. Added in Claude Code 2.1.129+. To verify the warning is gone, run `/doctor` after sync; "Skill listing will be truncated" should not appear. |
| `minimumVersion` | `2.1.219` | Floor for auto-updates and `claude update` — a stale install upgrades to ≥2.1.219 on next launch, ensuring the `opus` alias can resolve to the newest Opus its provider offers (Opus 5 on the Anthropic API; Opus 4.6 on Microsoft Foundry) instead of capping Anthropic API users at Opus 4.8. It subsumes every older requirement the kit relies on (Opus 5 on the Anthropic API needs 2.1.219; Fable 5 — incl. as the advisor — needs 2.1.170; Opus 4.8 needs 2.1.154; `skillListingBudgetFraction` needs 2.1.129). Distinct from the managed-only `requiredMinimumVersion`. |

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
./docks-kit harnesses                # view or change this machine's flag-less sync selection
./docks-kit sync                     # sync this machine's harness selection (additive)
./docks-kit sync --dry-run           # preview before applying
./docks-kit sync --skip-bubblewrap   # skip optional bubblewrap bootstrap (Codex Linux sandbox)
./docks-kit sync --reconcile         # replace ~/.claude/settings.json wholesale (settings layer only)
./docks-kit sync --prune             # uninstall plugins/marketplaces not in SoT (plugin layer only)
./docks-kit sync --reconcile --prune # full reset to SoT (both layers)
./docks-kit sync claude --claude-compact-window=680k  # deploy-time: raise autocompact window (any token count: 680k or 680000) for disposable sessions (model unchanged)
./docks-kit sync claude --claude-permissive           # deploy-time: empty permissions.ask/deny — unattended commits/pushes in sandboxes
./docks-kit sync --claude-plugin=supabase   # opt in the supabase plugin (install + enable in deployed settings)
./docks-kit sync --claude-plugin=n8n        # opt in the n8n-mcp-skills plugin (add marketplace + install + enable); repeatable/comma-separated
./docks-kit model claude opus        # deploy-time: set Opus explicitly (matches the SoT; standalone form of --claude-model=)
./docks-kit status                   # show deployed vs SoT state
./docks-kit toolchain check          # verify installed tools against SoT/toolchain.json floors
```

On Windows, replace `./docks-kit` with `.\docks-kit.ps1` in these checkout
commands.

In an active Claude Code session, run `/reload-plugins` after `./docks-kit sync` to activate any newly installed plugins without restarting.

The sync auto-detects the repo location, starts the Claude pipeline with the Bun bootstrap, materializes and merges `settings.json` (deep-merge with array concat+unique for `permissions.{allow,deny,ask}`), writes `showTurnDuration` to `~/.claude.json`, and copies the status line and hook scripts before atomically committing settings. `syncRemovals` then force-prunes the retired permission inventory from the deployed file. Deploy-time modifiers run only after that base settings commit.

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

Unlike `--reconcile`/`--prune` (which reconcile toward SoT), modifiers change the **deployed** config for a specific machine profile. The SoT is never touched, and a later flag-less sync reasserts it: Claude returns to Opus/high/advisor-off and Codex returns to its model/high effort. Modifiers run after the base merge/removal passes, are idempotent, honor `--dry-run`, and warn when their tool target is not selected. `docks-kit model <tool> <value>` is the standalone form of the model modifiers.

| Flag | Changes (deployed only) | Use when |
|------|-------------------------|----------|
| `--claude-model=<m>` | top-level `model` (`default` deletes the key so the account default applies) | Override the Opus SoT on one machine; re-pass it after future syncs |
| `--claude-effort=<level>` | top-level `effortLevel`; `low`/`medium`/`high`/`xhigh`, with `default` → SoT `high` | Tune persisted Claude effort without using the env var that would override skill/subagent frontmatter |
| `--claude-advisor=<on\|off\|default>` | `on` writes `advisorModel: fable`; `off`/`default` delete it | Opt one machine into Fable advisor; the SoT and flag-less sync keep advisor off |
| `--claude-compact-window=<tokens>` | `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW` → the given value (any token count: `680k` or `680000`) | **Disposable containers/sandboxes** running long autonomous work — never host machines, which stay on the SoT's 468K cap (the observed fidelity ceiling for interactive host sessions). The wider 680K window lets a container retain more before compaction when the extra headroom is worth the added rot. The flag does **not** select the model — only the compact trigger. Don't pass it on host machines: there the wider window just means later, lossier compactions |
| `--claude-permissive` | `permissions.ask` → `[]`, `permissions.deny` → `[]` | Disposable sandboxes/containers where prompts stall autonomous work. The SoT `ask` list is already minimal (2026-07-08 slim-down: only `git clean` / `docker volume rm` / `docker system prune` — the local-data destroyers; everything else defers to the auto-mode classifier, since `ask` entries force prompts even in auto mode), so this flag mostly matters for emptying `deny`. **Never on a host machine** — the deny list (secrets reads, `sudo`, force-push to main) is the kit's safety floor; emptying it is only acceptable where the blast radius is the container |

Codex mirrors the model/effort contract with `--codex-model=<m>` and
`--codex-effort=<level>`; Codex `default` effort restores `high`.

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

This is a **narrow, deliberate exception** to "additive by default": entries are force-removed from every synced machine, so the manifest lists **only kit-owned keys or exact permission rules** the kit used to set and has since dropped — pruned from the kit-managed `settings.json`. A deliberate per-checkout override of any of these belongs in **that checkout's `.claude/settings.local.json`**, which sync never touches; never list a key or rule the kit never owned (a user's custom env vars, `mcpServers`, theme, permission), which the additive merge already preserves. All removals are idempotent and honor `--dry-run`. Current baseline entries include the dead `disable-claudeai-connectors.sh` hook, superseded `alert_bubble.mp3`, `showTurnDuration` in settings, stale kit env vars, and the four unsupported path-qualified `Write(...)` rules replaced by `Edit(...)`. A second, readiness-gated subset removes `statusline.sh`, `fetch-usage.sh`, `hooks/notify.sh`, and `hooks.Stop` only after Bun runtime assets and new settings commit successfully; deferred/failed migration preserves them. Add a newly-deprecated artifact by editing the removed manifest in `claudeSync.ts`.

### Troubleshooting

- **Status line missing 5h/7d usage** — Claude omits native `rate_limits` for API-key/unsupported-plan sessions and before the first API response; the statusline intentionally omits only that segment. There is no OAuth fallback or cache to clear. If the whole statusline is absent, re-run `./docks-kit sync claude` to restore Bun/runtime assets and inspect the migration warning.
- **Auto-compact firing at the wrong time** — the kit sets `CLAUDE_CODE_AUTO_COMPACT_WINDOW=468000` (compaction at ~95% → ~445K). To delay (containers only), pass `./docks-kit sync claude --claude-compact-window=680k` or raise the value; to fire earlier in one checkout, lower it or add `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=N` **to that checkout's `.claude/settings.local.json`** (the `removed` manifest prunes it from the kit-managed `settings.json`). Both env vars at https://code.claude.com/docs/en/env-vars.
- **Schema validation warnings on settings.json** — `showTurnDuration` belongs in `~/.claude.json`, not `settings.json`. `./docks-kit sync` writes it to the right file, and the `removed` manifest prunes any stale `showTurnDuration` from `settings.json` on every sync.
- **Subagent rejected by SubagentStop hook** — the hook expects file:line references. Verifiers returning "no issues found" / mode-selection responses are whitelisted. If a legitimate reply is still being rejected, extend the exception pattern in the hook command.
- **Fable session silently running on Opus** — Fable 5's safety classifiers flagged a message and auto-switched the session to Opus 4.8 (`switchModelsOnFlag`). Check the status line model name; `/model fable` to return. `claude --safe-mode` isolates whether kit customizations trip the first-request flag.
- **`/plugin marketplace add DocksDocks/docks` fails with "marketplace.json not found"** — clear the partial cache: `/plugin marketplace remove DocksDocks-docks` then re-add.
- **Plugin commands not appearing after install** — run `/reload-plugins`. Commands are namespaced as `/docks:<name>` (e.g., `/docks:security`).

### Plans

The plan record is a GitHub issue (see `AGENTS.md` § Plans and `docs/PLAN.md`). Main context invokes `plan-manager` directly; it owns the decision through verified archive. Two read-only reviewer wrappers ship, `plan-reviewer` and `code-reviewer`.

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
