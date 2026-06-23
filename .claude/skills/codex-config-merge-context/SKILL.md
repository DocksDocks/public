---
name: codex-config-merge-context
description: Use when modifying codex::sync_config, codex::scrub_deprecated_features, codex::merge_top_level_settings, codex::merge_table_settings, codex::ensure_bubblewrap, codex::sync_rules, or any TOML in SoT/.codex/config.toml and SoT/.codex/rules/*.rules; covers the two-pass awk merger (top-level key replacement before [table] boundary, wholesale [table] block replacement), the [features].use_legacy_landlock scrubber that also removes the now-empty [features] table, the unshare -Ur true user-namespace validation for system bubblewrap and Codex's bundled helper fallback, the kit-managed *.rules deployment that preserves user-learned ~/.codex/rules/default.rules, and the prefix_rule(pattern=[...], decision=...) format in docks.rules.
user-invocable: false
metadata:
  source_files:
    - path: lib/codex.sh
      lines: "36-290"
    - path: SoT/.codex/config.toml
      lines: "1-19"
    - path: SoT/.codex/rules/docks.rules
      lines: "1-50"
  updated: "2026-06-23"
---

# Codex Config Merge

<constraint>
TOML has no `jq` equivalent. Do NOT attempt to use `jq` on `config.toml`. The kit uses two sequential awk passes: top-level key replacement (`codex::merge_top_level_settings`) then wholesale table replacement (`codex::merge_table_settings`).
</constraint>

<constraint>
Table blocks are ALWAYS replaced wholesale — there is no field-level merge within a TOML `[table]`. Adding a new field to a SoT `[table]` block replaces the entire user table, losing any user-added fields in that table.
</constraint>

<constraint>
`codex::ensure_bubblewrap` is the ONLY place in the kit that issues a `sudo`-requiring command (`if ! eval "$pm_install"; then` in `codex::ensure_bubblewrap`). It runs before any Codex sync step. System bubblewrap is recommended on Linux, but Codex can fall back to its bundled helper when unprivileged user namespaces work. `--no-rtk` (`SKIP_OPTIONAL_BOOTSTRAP=1`) skips auto-install but warns.
</constraint>

## When to Use

- Adding a new top-level key to `SoT/.codex/config.toml`
- Adding a new `[table]` block to `config.toml`
- Removing a deprecated TOML key
- Modifying `docks.rules` policy entries
- Adding a new kit-managed `*.rules` file
- Debugging why a user's `[plugins."custom@marketplace"]` block survived or was wiped

## Core Patterns

### `codex::sync_config` Call Sequence

```
codex::sync_config
├── [first install] cp SoT/config.toml → user config.toml
├── cp user_config.toml → user_config.toml.bak
├── codex::scrub_deprecated_features   (removes use_legacy_landlock + empty [features])
├── codex::merge_top_level_settings    (awk pass 1: replace/append top-level keys)
└── codex::merge_table_settings        (awk pass 2: replace [table] blocks wholesale)
```

### Pass 1: Top-Level Key Replacement (`codex::merge_top_level_settings`)

For each `key = value` line from the SoT (extracted before the first `[table]` boundary):

```bash
awk -v key="$setting_key" -v replacement="$setting_line" '
  BEGIN { in_table = 0; replaced = 0 }
  /^\[/ { if (!replaced) { print replacement; replaced = 1 }; in_table = 1; print; next }
  !in_table && $0 ~ ("^" key "[[:space:]]*=") { if (!replaced) { print replacement; replaced = 1 }; next }
  { print }
  END { if (!replaced) { print replacement } }
' "$user_codex_settings" > "$tmp_file"
```

Effect: existing `key = value` in user config is replaced; if key absent, it's appended. Only applies to lines BEFORE the first `[table]` header.

### Pass 2: Wholesale Table Replacement (`codex::merge_table_settings`)

```bash
# Extract table block from SoT
table_block="$(
  awk -v header="$table_header" '
    $0 == header { printing = 1 }
    printing && $0 ~ /^\[/ && $0 != header { exit }
    printing { print }
  ' "$codex_settings"
)"

# Delete existing table from user config
awk -v header="$table_header" '
  $0 == header { skip = 1; next }
  skip && /^\[/ { skip = 0 }
  !skip { print }
' "$user_codex_settings" > "$tmp_file" && mv "$tmp_file" "$user_codex_settings"

# Append SoT table block
printf '\n'
printf '%s\n' "$table_block"
```

The `printf '\n'` before the block ensures a blank-line separator — omitting it concatenates the last line of the prior section with the table header.

### Deprecated Feature Scrubber (`codex::scrub_deprecated_features`)

Removes `use_legacy_landlock = …` line AND the now-empty `[features]` table. The `keep` variable in awk tracks whether any non-landlock content exists in the `[features]` block:

```bash
grep -q '^use_legacy_landlock[[:space:]]*=' "$user_codex_settings" || return 0
```

Returns early (no-op) if `use_legacy_landlock` not present. Only runs when the deprecated key is detected.

### `codex::ensure_bubblewrap`

| OS | Action |
|----|--------|
| macOS (`Darwin*`) | `return` — uses Seatbelt natively (`codex::_bwrap_supported_os`) |
| Linux | Probe `command -v bwrap`; if absent, detect PM and install recommended system bubblewrap |
| Other | `warn` and `return` (`codex::_bwrap_supported_os`) |

Package manager detection precedence: `apt-get` → `dnf` → `pacman` → `zypper` (`codex::_bwrap_detect_pm_install_cmd`).

Validation after install: `unshare -Ur true` (`codex::_bwrap_verify_userns`) — tests unprivileged user namespaces used by system bubblewrap and the bundled Codex helper. Ubuntu 24.04+ AppArmor restrictions can block this; the warning should point to the `bwrap-userns-restrict` profile first and the `kernel.apparmor_restrict_unprivileged_userns=0` sysctl only as a fallback.

### `codex::sync_rules`

```bash
while IFS= read -r rule_file; do
  [[ -f "$rule_file" ]] || continue
  user_rule_file="$user_codex_rules_dir/$(basename "$rule_file")"
  [[ -f "$user_rule_file" ]] && cp "$user_rule_file" "$user_rule_file.bak"
  cp "$rule_file" "$user_rule_file"
done < <(find "$codex_rules_dir" -maxdepth 1 -type f -name '*.rules' | sort)
```

Kit-managed `*.rules` files are copied wholesale (not merged). `~/.codex/rules/default.rules` (user-learned Codex approvals) is never touched — it's not in `SoT/.codex/rules/`.

### `docks.rules` Format (SoT/.codex/rules/docks.rules:1-50)

```
prefix_rule(pattern=["<cmd>", "<subcommand>"], decision="<allow|prompt|forbidden>")
```

| Decision | Meaning | Examples |
|----------|---------|---------|
| `allow` | Auto-approved | `ls`, `cat`, `git status`, `grep` |
| `prompt` | User confirmation required | `rm`, `git push`, `sed -i`, `docker run` |
| `forbidden` | Never approved | `sudo`, `eval`, `mkfs`, `dd` |

Pattern arrays use exact prefix matching on command argv. `["git", "status"]` matches `git status --short` but not `git stash`.

## Key Decisions

- TOML merge is two sequential passes, not one — top-level keys and table blocks are structurally different and require different awk logic.
- Table blocks are replaced wholesale (`codex::merge_table_settings`) because field-level TOML merge via awk would be extremely fragile. Trade-off: user-added fields inside kit-managed tables are silently wiped on sync.
- `scrub_deprecated_features` runs BEFORE both merge passes (`codex::sync_config`) — ensures deprecated keys don't survive the merge step.
- `default.rules` is never in `SoT/.codex/rules/` — Codex writes its own learned approvals there and the kit must not overwrite them.

## Gotchas

- **Table block append accumulates blank lines**: `printf '\n'` in `codex::merge_table_settings` adds a blank line separator before each appended block. If the SoT table block itself ends with a blank line, repeated syncs accumulate extra blank lines between tables. Symptom: growing blank-line gaps in `~/.codex/config.toml` between `[tui]` and `[plugins."docks@docks"]`.
- **Pass 2 is not idempotent on re-entry**: the delete-then-append pattern means calling `merge_table_settings` twice on the same file appends the block twice. In a single sync run this is fine (delete pass removes the block from the previous run). Calling the function directly outside `codex::sync_config` may produce duplicate tables.
- **User-added `[table]` blocks**: any user-added `[plugins."custom@marketplace"]` block in `~/.codex/config.toml` is preserved ONLY if the table header is absent from the SoT. If a SoT table header matches the user's, the user's block is deleted and replaced.
- **`unshare -Ur true` blocked on Ubuntu 24.04+**: bubblewrap may be installed but AppArmor can block unprivileged user namespaces. The sync warns and continues; prefer the `bwrap-userns-restrict` AppArmor profile before using the broader sysctl fallback.

## References

- `references/awk-merger.md` — annotated awk for both passes with edge cases; read when modifying or debugging TOML merge behavior
- `references/rules-format.md` — `prefix_rule` examples from `docks.rules`; read when adding new command policies
