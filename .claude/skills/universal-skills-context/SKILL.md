---
name: universal-skills-context
description: Use when modifying skills::sync_universal, skills::heal_claude_symlink, skills::reconcile_removals, skills::update_snapshot, skills::_normalize_manifest, skills::sync_agent_browser_cli / skills::_agent_browser_install, skills::sync_effect_solutions_cli / skills::_effect_solutions_install, skills::_bun_bootstrap, skills::_find_bun, or any entry in SoT/.agents/skills.txt; covers the source-first npx skills add slug -g -y -a claude-code codex order (variadic -a swallows the slug if placed last), the two-agent vs single-agent storage model (canonical ~/.agents/skills/ + ~/.claude/skills/ symlink vs copy-direct), the ~/.agents/.kit-managed-skills snapshot diff for --prune removals, the thin toolchain::ensure wiring of both CLI installs (mode-taking install callbacks; upgrade gated by SoT/toolchain.json track policy — skills::_agent_browser_newer_npm is deleted, superseded by toolchain::_is_newer), the agent-browser install --with-deps Linux sudo prompt (first install only pulls Chrome), and the Bun-based effect-solutions CLI install (gated on effect-kit enabled, bootstraps Bun via skills::_bun_bootstrap, idempotent bun add -g @latest self-upgrade, symlinks bun + CLI into ~/.local/bin to clear ~/.bashrc non-interactive guard).
user-invocable: false
metadata:
  source_files:
    - path: lib/skills.sh
      lines: "1-358"
    - path: SoT/.agents/skills.txt
      lines: "1-14"
  updated: "2026-07-08"
---

# Universal Skills Bootstrap

> **Feature-frozen surface.** `lib/*.sh` accepts bug fixes only (AGENTS.md
> § Engineering rules); new capabilities land in EngineNative
> (`cli/src/engine-native/`), the default engine since the step-6 flip of
> the `windows-support` plan — see the `engine-native-context` skill. A bug
> fix that changes behavior here must be mirrored in the TS port and pass
> the parity suites (`cli/test/parity-dryrun.ts` / `parity-mutation.ts`).

<constraint>
The `<slug>` argument MUST precede `-a` in `npx skills add`. The `-a/--agent` flag is variadic and consumes all following positional arguments as agent names. If slug is placed after `-a`, it is treated as an agent name and the install exits 0 with nothing installed. (skills::sync_universal (the slug-before-`-a` comment) + skills::sync_universal (the npx skills add invocation))
</constraint>

<constraint>
Always name BOTH agents: `-a claude-code codex`. Naming only one agent triggers a copy-direct shortcut: the CLI writes directly into that tool's per-tool directory instead of `~/.agents/skills/<name>/`. The canonical path is never created; the symlink mechanism never fires; Codex gets no coverage. (skills::sync (two-agent comment))
</constraint>

<constraint>
`skills::update_snapshot` MUST run last (skills::sync (update_snapshot runs last)). If aborted mid-run, the snapshot reflects the previous known-good state, not a partial state. Never move `update_snapshot` before `sync_universal` or `reconcile_removals`.
</constraint>

## When to Use

- Adding a new slug to `SoT/.agents/skills.txt`
- Debugging why a skill was not installed or symlinked
- Understanding why `~/.claude/skills/<name>` is missing after `npx skills add` succeeded
- Modifying the removal/snapshot mechanism
- Troubleshooting the `agent-browser` CLI install on Linux

## Core Patterns

### Storage Model

```
~/.agents/skills/<basename>/        ← canonical (universal path)
  └── SKILL.md
~/.claude/skills/<basename>         ← symlink → ../../.agents/skills/<basename>
~/.codex/skills/<basename>          ← (handled by Codex natively from ~/.agents/)
```

Source: skills::sync (path vars), skills::heal_claude_symlink. Relative symlink target `../../.agents/skills/<basename>` matches `installer.ts:createSymlink` from the upstream vercel-labs/skills CLI.

### Correct `npx skills add` Invocation (skills::sync_universal (the npx skills add invocation))

```bash
npx --yes skills add "$slug" -g -y -a claude-code codex
```

| Position | Argument | Notes |
|----------|----------|-------|
| 1st positional | `"$slug"` | `<owner>/<repo>` — MUST be before `-a` |
| `-g` | global install flag | writes to `~/.agents/skills/` |
| `-y` | non-interactive | auto-confirm |
| `-a` | agents list | variadic; MUST come after all positional args |
| `claude-code` | first agent | triggers multi-agent mode |
| `codex` | second agent | triggers multi-agent mode |

### `skills.txt` Comment Stripping (`skills::_normalize_manifest`)

Manifest parsing is centralized in ONE awk helper — the single source of truth so `skills::sync_universal`, `skills::_load_slug_list`, and `skills::update_snapshot` can never diverge on parsing:

```bash
# skills::_normalize_manifest — one cleaned slug per line
awk '
  /^[[:space:]]*#/ { next }
  /^[[:space:]]*$/ { next }
  { sub(/[[:space:]]*#.*$/, ""); gsub(/[[:space:]]+/, ""); if (length($0)) print }
' "$1"
```

Both whole-line `# comments` and `slug # inline comments` are supported. Strip happens before `basename` extraction. Missing this step causes `npx skills add` to receive `owner/repo # comment text` as the slug. `skills::sync_universal` consumes the normalized stream in both dry-run and real mode (its DRY_RUN branch sits at the action point, so both modes see the same slug set).

### Idempotency Pre-Check (skills::sync_universal (idempotency pre-check))

```bash
if [[ -d "$SKILLS_DIR/$basename" ]]; then
  already=$((already + 1))
  if skills::heal_claude_symlink "$basename"; then
    healed=$((healed + 1))
  fi
  continue   # skip npx add; canonical already present
fi
```

`-d` checks the canonical `~/.agents/skills/<basename>` directory. Even when the skill exists, `heal_claude_symlink` is called to repair the per-tool symlink if missing.

### `skills::heal_claude_symlink` Repair Logic

```bash
local rel_target="../../.agents/skills/$basename"   # skills::heal_claude_symlink (rel_target)

if [[ -L "$claude_link" ]]; then
  current="$(readlink "$claude_link")"
  if [[ "$current" == "$rel_target" ]]; then
    return 1    # already correct
  fi
  rm -f "$claude_link"    # skills::heal_claude_symlink (replace stale symlink)
elif [[ -e "$claude_link" ]]; then
  warn "… exists as a real path — leaving alone"   # skills::heal_claude_symlink (real-directory guard)
  return 1
fi
# … ln -s "$rel_target" "$claude_link"   # skills::heal_claude_symlink (ln -s)
```

Three cases: (a) symlink with correct target — no-op; (b) symlink with wrong target — replace; (c) real directory — warn and skip (never destroys user content).

### `.kit-managed-skills` Snapshot (skills::update_snapshot)

```bash
# skills::update_snapshot
skills::_normalize_manifest "$SKILLS_MANIFEST" | sort -u > "$SKILLS_SNAPSHOT"
```

Written to `~/.agents/.kit-managed-skills`. Format: one slug per line, sorted. Compared against current `skills.txt` in `skills::reconcile_removals` to detect removed slugs.

### Removal Flow (skills::reconcile_removals — `--prune` only)

Gated on `PRUNE=1` in `skills::sync` (the PRUNE gate before `sync_agent_browser_cli`).

1. Parse current slugs from `skills.txt` → `current_slugs` array (`skills::_load_slug_list`, which also rides `skills::_normalize_manifest`)
2. Read `~/.agents/.kit-managed-skills` → `snapshot_slugs` array
3. For each slug in snapshot not in current: `skills::_remove_one_slug` runs `npx --yes skills remove --global -y -a '*' -s "$basename"`

The `-a '*'` in the remove command removes from ALL agent tool directories. The `-s "$basename"` is the skill name (not slug).

### CLI binary installs — thin `toolchain::ensure` callers

Both CLI bootstraps are now thin wrappers: presence/version/gating logic lives in `toolchain::ensure` (see the `toolchain-context` skill); lib/skills.sh owns only the gate + the install callback, called as `<callback> <install|upgrade> [version]`:

| Wrapper | Gate | `toolchain::ensure` call | Callback behavior |
|---------|------|--------------------------|-------------------|
| `skills::sync_agent_browser_cli` | `vercel-labs/agent-browser` declared in skills.txt; npm on PATH | `toolchain::ensure agent-browser skills::_agent_browser_install` | `npm install -g agent-browser` always; `install` mode ALSO runs `agent-browser install` (Chrome for Testing, `--with-deps` on Linux — may prompt sudo); `upgrade` mode skips the Chrome download (`skills::_agent_browser_install`, the mode==install Chrome branch) |
| `skills::sync_effect_solutions_cli` | `"effect-kit@docks": true` grepped in SoT settings.json | `toolchain::ensure effect-solutions skills::_effect_solutions_install` | `skills::_bun_bootstrap` first (echoes bun path; installs Bun download-then-run when absent), then idempotent `bun add -g effect-solutions@latest` for BOTH modes — this is what finally gave the CLI the self-upgrade agent-browser always had — then symlinks bun + CLI into `~/.local/bin` (`skills::_effect_solutions_install`, the `bun pm -g bin` link block) |

The version compare, latest lookup, and verified-pin prompt all moved to `lib/toolchain.sh` (`toolchain::_is_newer`, `toolchain::latest_version`, `toolchain::_gate`) with the `track` policy in `SoT/toolchain.json`. `skills::_agent_browser_newer_npm` is DELETED — do not cite it.

## Key Decisions

- Snapshot write is always last (skills::sync (update_snapshot runs last)) — prevents partial-state snapshots on aborted runs.
- `skills::heal_claude_symlink` is called on EVERY sync for already-present skills (skills::sync_universal (heal call in pre-check)) — symlinks can drift without the user noticing.
- `agent-browser` has its own install wiring (`skills::sync_agent_browser_cli` → `toolchain::ensure agent-browser skills::_agent_browser_install`) because the SKILL.md alone provides instructions but the CLI binary drives Chrome. Unlike the install-once skills, it **self-upgrades** via the `track` policy in `SoT/toolchain.json`: `toolchain::ensure` compares installed vs npm-latest with `toolchain::_is_newer` (strictly-newer numeric per-field sort — a locally-newer pre-release is never downgraded; an unknown latest, e.g. offline, means no action) and calls the callback in `upgrade` mode only when strictly older. The Chrome download (`agent-browser install`) is NOT repeated on upgrade (`skills::_agent_browser_install`, the mode==install Chrome branch), so routine syncs don't re-trigger the Linux `--with-deps` sudo prompt.
- `SKILLS_PRESENT` tally (skills::sync_universal (SKILLS_PRESENT tally)) counts installed + already-present for the summary; does NOT re-scan `~/.agents/skills/` (which would include user-installed skills).
- The optional `effect-solutions` CLI is wired the same way (`skills::sync_effect_solutions_cli` → `toolchain::ensure effect-solutions skills::_effect_solutions_install`), gated on effect-kit being enabled in SoT (a `grep` for `"effect-kit@docks": true` in `SoT/.claude/settings.json`). Install and upgrade are the SAME idempotent `bun add -g effect-solutions@latest` — the `track` policy finally gives this CLI the self-upgrade agent-browser always had (pre-toolchain syncs only installed-when-absent). The callback symlinks BOTH `bun` and the CLI into `~/.local/bin` (`skills::_effect_solutions_install`, the ln -sf pair) — linking only the CLI fails at run time because its `#!/usr/bin/env bun` shebang needs `bun` on PATH too. `bun pm -g bin` is the authoritative global-bin query (it varies with `BUN_INSTALL`/`XDG_CACHE_HOME`); `skills::_find_bun` resolves bun itself, which also lives off the non-interactive PATH.
- Bun bootstrap is its own reusable helper, `skills::_bun_bootstrap` — echoes the bun path when present, else download-then-run installs Bun (never `curl | bash`). Called by `skills::_effect_solutions_install` and directly by `engine::toolchain ensure bun`.

## Gotchas

- **Slug after `-a` fails silently**: `npx skills add -a claude-code codex "$slug"` exits 0 and installs nothing. The canonical directory is never created; every sync re-attempts the add and always fails silently. (skills::sync_universal (the slug-before-`-a` comment))
- **Real directory at `~/.claude/skills/<name>`**: `heal_claude_symlink` warns and skips (skills::heal_claude_symlink (real-directory guard)). The two copies diverge silently. Fix: manually `rm -rf ~/.claude/skills/<name>` then re-run sync.
- **First `--prune` with no snapshot**: `reconcile_removals` returns early if `~/.agents/.kit-managed-skills` does not exist (skills::reconcile_removals (missing-snapshot early return)). No removal occurs. Run a real sync first to write the snapshot, then `--prune` to reconcile.
- **`agent-browser install --with-deps` on Linux**: may prompt for `sudo` to install system libs (`libnss3`, `libatk`, etc.) via the package manager. The `--with-deps` flag is Linux-only (`skills::_agent_browser_install`, the uname case adding --with-deps). It runs only in `install` mode — the `upgrade` path bumps the npm package without re-running it, so upgrades don't re-prompt for sudo.
- **Self-upgrade adds one network call per sync**: when a `track`-policy tool is present, `toolchain::ensure` queries the latest version (`npm view <tool> version` for agent-browser/effect-solutions) every sync. It is best-effort — an empty/unknown latest (offline, npm absent) logs "latest unknown — no action" and leaves the installed tool alone. Details in the `toolchain-context` skill.
- **effect-solutions unreachable in agent shells**: bun's global bin (`~/.cache/.bun/bin` when `BUN_INSTALL` is unset, else `~/.bun/bin`) and `~/.bun/bin` itself sit off the non-interactive PATH, and `~/.bashrc`'s `*i*) ;; *) return;;` guard means rc PATH edits never reach non-interactive (sync/agent) shells. `skills::_effect_solutions_install` sidesteps this by symlinking into `~/.local/bin` (already on the agent PATH, matching Codex's official standalone install path). Do NOT "fix" a missing CLI by editing `~/.bashrc`; non-interactive shells never read past the guard.

## References

- `references/storage-model.md` — path diagram + table; read when debugging missing symlinks or unexpected canonical paths
- `references/cli-arg-trap.md` — the source-first rule with regression context; read before modifying the `npx skills add` invocation
