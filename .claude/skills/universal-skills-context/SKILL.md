---
name: universal-skills-context
description: Use when modifying skills::sync_universal, skills::heal_claude_symlink, skills::reconcile_removals, skills::update_snapshot, skills::sync_agent_browser_cli, or any entry in SoT/.agents/skills.txt; covers the source-first npx skills add <slug> -g -y -a claude-code codex invocation order (variadic -a would swallow the slug if placed last), the two-agent vs single-agent storage model (canonical ~/.agents/skills/<name>/ + ~/.claude/skills/<name> symlink vs copy-direct), the relative symlink target ../../.agents/skills/<basename> matching the upstream CLI installer.ts, the ~/.agents/.kit-managed-skills snapshot diff for removals, and the agent-browser install --with-deps Linux sudo prompt.
user-invocable: false
metadata:
  source_files:
    - path: lib/skills.sh
      lines: "1-278"
    - path: SoT/.agents/skills.txt
      lines: "1-14"
  updated: "2026-05-28"
---

# Universal Skills Bootstrap

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

### `skills.txt` Comment Stripping (skills::sync_universal (comment stripping))

```bash
[[ -z "$slug" || "$slug" =~ ^[[:space:]]*# ]] && continue
slug="${slug%%#*}"     # strip inline comment
slug="${slug// /}"     # strip spaces
[[ -z "$slug" ]] && continue
```

Both whole-line `# comments` and `slug # inline comments` are supported. Strip happens before `basename` extraction. Missing this step causes `npx skills add` to receive `owner/repo # comment text` as the slug.

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
awk '
  /^[[:space:]]*#/ { next }
  /^[[:space:]]*$/ { next }
  { sub(/[[:space:]]*#.*$/, ""); gsub(/[[:space:]]+/, ""); if (length($0)) print }
' "$SKILLS_MANIFEST" | sort -u > "$SKILLS_SNAPSHOT"
```

Written to `~/.agents/.kit-managed-skills`. Format: one slug per line, sorted. Compared against current `skills.txt` in `skills::reconcile_removals` to detect removed slugs.

### Removal Flow (skills::reconcile_removals)

1. Parse current slugs from `skills.txt` → `current_slugs` array
2. Read `~/.agents/.kit-managed-skills` → `snapshot_slugs` array
3. For each slug in snapshot not in current: `npx --yes skills remove --global -y -a '*' -s "$basename"`

The `-a '*'` in the remove command removes from ALL agent tool directories. The `-s "$basename"` is the skill name (not slug).

## Key Decisions

- Snapshot write is always last (skills::sync (update_snapshot runs last)) — prevents partial-state snapshots on aborted runs.
- `skills::heal_claude_symlink` is called on EVERY sync for already-present skills (skills::sync_universal (heal call in pre-check)) — symlinks can drift without the user noticing.
- `agent-browser` has its own install helper (`skills::sync_agent_browser_cli`) because the SKILL.md alone provides instructions but the CLI binary drives Chrome (skills::sync_agent_browser_cli).
- `SKILLS_PRESENT` tally (skills::sync_universal (SKILLS_PRESENT tally)) counts installed + already-present for the summary; does NOT re-scan `~/.agents/skills/` (which would include user-installed skills).

## Gotchas

- **Slug after `-a` fails silently**: `npx skills add -a claude-code codex "$slug"` exits 0 and installs nothing. The canonical directory is never created; every sync re-attempts the add and always fails silently. (skills::sync_universal (the slug-before-`-a` comment))
- **Real directory at `~/.claude/skills/<name>`**: `heal_claude_symlink` warns and skips (skills::heal_claude_symlink (real-directory guard)). The two copies diverge silently. Fix: manually `rm -rf ~/.claude/skills/<name>` then re-run sync.
- **First `--remove-plugins` with no snapshot**: `reconcile_removals` returns early if `~/.agents/.kit-managed-skills` does not exist (skills::reconcile_removals (missing-snapshot early return)). No removal occurs. Run a real sync first to write the snapshot, then `--remove-plugins` to reconcile.
- **`agent-browser install --with-deps` on Linux**: may prompt for `sudo` to install system libs (`libnss3`, `libatk`, etc.) via the package manager. The `--with-deps` flag is Linux-only (skills::sync_agent_browser_cli (Linux --with-deps)).

## References

- `references/storage-model.md` — path diagram + table; read when debugging missing symlinks or unexpected canonical paths
- `references/cli-arg-trap.md` — the source-first rule with regression context; read before modifying the `npx skills add` invocation
