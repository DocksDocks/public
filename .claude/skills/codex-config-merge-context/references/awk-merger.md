# awk-Based TOML Merger — Annotated

## Critical Constraints

- Pass 1 (top-level) and Pass 2 (tables) are SEQUENTIAL. Run in order: scrub → top-level → tables. (lib/codex.sh:175-177)
- Table blocks are replaced WHOLESALE. No field-level merge. (lib/codex.sh:274-301)
- Write to `.tmp` then `mv` — never write directly to the target. (lib/codex.sh:241, 266, 295)

## Pass 1: Top-Level Key Replacement (lib/codex.sh:231-272)

### Source extraction (what keys to merge in)

```bash
awk '
  /^\[/ { exit }                      # stop at first [table] header
  /^[[:space:]]*($|#)/ { next }       # skip blank/comment lines
  /^[A-Za-z0-9_.-]+[[:space:]]*=/ { print }  # emit key = value lines
' "$codex_settings"
```

### Per-key replacement awk

```bash
awk -v key="$setting_key" -v replacement="$setting_line" '
  BEGIN { in_table = 0; replaced = 0 }
  /^\[/ {
    if (!replaced) { print replacement; replaced = 1 }  # append before first table
    in_table = 1
    print
    next
  }
  !in_table && $0 ~ ("^" key "[[:space:]]*=") {
    if (!replaced) { print replacement; replaced = 1 }  # replace existing key
    next                                                  # drop old line
  }
  { print }
  END { if (!replaced) { print replacement } }           # append if key absent
' "$user_codex_settings" > "$tmp_file" && mv "$tmp_file" "$user_codex_settings"
```

Edge cases:
- Key in user config but not in SoT: user's line is printed unchanged (falls through to `{ print }`)
- Key absent from user config: appended at `END` (after all table headers, at file end) OR before first `[` if there are no tables

## Pass 2: Wholesale Table Replacement (lib/codex.sh:274-301)

### Table header extraction

```bash
grep -E '^\[[^]]+\]' "$codex_settings"   # all [table] headers from SoT
```

### Block extraction from SoT

```bash
awk -v header="$table_header" '
  $0 == header { printing = 1 }
  printing && $0 ~ /^\[/ && $0 != header { exit }   # stop at next table
  printing { print }
' "$codex_settings"
```

Includes the header line and all content until the next `[table]` or EOF.

### Delete existing block from user config

```bash
awk -v header="$table_header" '
  $0 == header { skip = 1; next }    # start skipping at header line
  skip && /^\[/ { skip = 0 }         # stop skipping at next table header
  !skip { print }                    # print everything not skipped
' "$user_codex_settings" > "$tmp_file" && mv "$tmp_file" "$user_codex_settings"
```

### Append SoT block

```bash
{
  printf '\n'             # blank-line separator (lib/codex.sh:298)
  printf '%s\n' "$table_block"
} >> "$user_codex_settings"
```

The `>>` appends to the already-modified user config.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Key present at top-level in user but absent from SoT | User's line preserved (no removal pass for top-level) |
| `[table]` in SoT absent from user config | Block appended at end with blank-line separator |
| `[table]` in user config absent from SoT | User's block preserved (delete pass only removes SoT-declared headers) |
| `[features]` with only `use_legacy_landlock` | `scrub_deprecated_features` removes entire block before merge passes |

## Gotchas

- **Blank-line accumulation**: if a SoT table block ends with `\n`, `printf '%s\n' "$table_block"` adds another `\n`. Combined with the leading `printf '\n'`, every block ends with two newlines. Over multiple syncs, the file grows. This is cosmetic but may confuse diff-based diagnostics.
- **`grep -E '^\[[^]]+\]'` matches quoted table names**: `[plugins."docks@docks"]` matches `\[[^]]+\]` because `"` is not `]`. This is correct behavior — quoted table names are matched and their blocks are replaced wholesale.
