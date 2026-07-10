# docks-kit overview

docks-kit is a portable configuration kit for AI coding agents. Per-tool
Single Source of Truth (SoT) directories are deployed to each tool's
user-config location — clone once, sync everywhere, get a consistent
AI-assisted dev environment on every machine.

## Pieces

| Piece | Role |
|-------|------|
| `SoT/.claude/` | Claude Code config (settings template, Bun runtime programs, CLAUDE.md) |
| `SoT/.codex/` | Codex config (config.toml, rules, AGENTS.md, marketplace) |
| `SoT/.agents/` | Universal agent skills manifest (agentskills.io standard) |
| `SoT/models.json` | Kit-verified model catalog (see `docks-kit docs models`) |
| `SoT/toolchain.json` | Verified-version floors for external tools (see `docks-kit docs toolchain`) |
| `cli/src/generated/sotPayload.ts` | Deterministic generated payload embedded in standalone/npm execution |
| `cli/src/engine-native/` | EngineNative mutation logic for sync/model/toolchain |
| `cli/` | This CLI (Effect-TS on Bun) plus bundled docs |
| `docks-kit` | Launcher: compiled binary → bun-from-source, with Bun auto-install |

## Design rules

- **Idempotent**: every sync step is safe to re-run; no-change syncs are no-ops.
- **Quiet on no-ops**: by default a re-run prints only real changes, warnings
  (with a platform-correct install command when a tool is missing), and the
  summary; `--verbose` / `-v` also prints the no-op confirmations.
- **Additive by default**: user-only keys/plugins/skills survive a plain sync.
  Reconciliation toward the SoT is explicit: `--reconcile` (settings) and
  `--prune` (plugins/marketplaces/skills).
- **Deploy-time modifiers** mutate deployed config only — the SoT never
  changes, and a later flag-less sync reverts them (`docks-kit docs modifiers`).
- **Engine/CLI split**: the CLI adds UX (typed flags, pickers, docs, JSON);
  EngineNative owns mutation. No-Bun recovery is a platform release binary.
- **Authoring/runtime split**: changes begin in `SoT/`; build/prepack freshness
  checks keep the generated in-memory payload byte-identical for every runtime.
- **Native Claude runtime**: three dependency-free Bun `.mjs` programs own the
  statusline, SessionStart, and Notification. Quotas come only from native
  `rate_limits`; missing Bun defers cutover without deleting legacy fallbacks.

## Where to go next

- `docks-kit docs sync-layers` — what a sync actually touches
- `docks-kit docs flags` — full flag reference + old→new renames
- `docks-kit status` — live doctor view of this machine
