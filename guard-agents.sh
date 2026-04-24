#!/bin/bash
# Guard: validate agent markdown structural correctness for every agent in a directory
# Usage: ./guard-agents.sh [path-or-file]   (default: ssot/.claude/agents)
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARG="${1:-$SCRIPT_DIR/ssot/.claude/agents}"
errors=0

# Accept either a directory or a single file.
if [ -f "$ARG" ]; then
  FILES=("$ARG")
elif [ -d "$ARG" ]; then
  FILES=("$ARG"/*.md)
  # Empty dir → pass silently with "no agents found"
  if ! compgen -G "$ARG/*.md" > /dev/null; then
    echo "Guard PASSED: no agent files found in $ARG"
    exit 0
  fi
else
  echo "FAIL: agents path not found: $ARG" >&2
  exit 1
fi

for file in "${FILES[@]}"; do
  [ -f "$file" ] || continue
  name_fromfile=$(basename "$file" .md)
  # Skip the .gitkeep sentinel
  [ "$name_fromfile" = ".gitkeep" ] && continue

  # Must open with `---` frontmatter fence on line 1
  first_line=$(head -n 1 "$file")
  if [ "$first_line" != "---" ]; then
    echo "FAIL: $name_fromfile — does not start with '---' frontmatter fence" >&2
    errors=$((errors + 1))
    continue
  fi

  # Must have a closing `---` fence
  fence_count=$(grep -c '^---$' "$file")
  if [ "$fence_count" -lt 2 ]; then
    echo "FAIL: $name_fromfile — frontmatter fence not closed (found $fence_count '---' lines)" >&2
    errors=$((errors + 1))
    continue
  fi

  # name field must match filename
  name_field=$(grep '^name:' "$file" | head -1 | sed 's/^name:[[:space:]]*//')
  if [ "$name_field" != "$name_fromfile" ]; then
    echo "FAIL: $name_fromfile — name field ('$name_field') does not match filename" >&2
    errors=$((errors + 1))
  fi

  # name must be kebab-case, no "anthropic"/"claude", ≤64 chars
  if ! echo "$name_field" | grep -qE '^[a-z][a-z0-9-]{0,63}$'; then
    echo "FAIL: $name_fromfile — name not kebab-case or >64 chars ('$name_field')" >&2
    errors=$((errors + 1))
  fi
  if echo "$name_field" | grep -qiE 'anthropic|claude'; then
    echo "FAIL: $name_fromfile — name must not contain 'anthropic' or 'claude'" >&2
    errors=$((errors + 1))
  fi

  # description: present, 10–1024 chars, starts with "Use when", contains a "Not" clause
  desc=$(grep '^description:' "$file" | head -1 | sed 's/^description:[[:space:]]*//')
  desc_len=${#desc}
  if [ "$desc_len" -lt 10 ]; then
    echo "FAIL: $name_fromfile — description missing or too short ($desc_len chars)" >&2
    errors=$((errors + 1))
  elif [ "$desc_len" -gt 1024 ]; then
    echo "FAIL: $name_fromfile — description exceeds 1024 chars ($desc_len)" >&2
    errors=$((errors + 1))
  fi
  if ! echo "$desc" | grep -qiE '^use when'; then
    echo "FAIL: $name_fromfile — description must start with 'Use when' (CSO)" >&2
    errors=$((errors + 1))
  fi
  if ! echo "$desc" | grep -qiE '\bnot\b'; then
    echo "FAIL: $name_fromfile — description missing 'Not for…' exclusion clause (prevents delegation collisions)" >&2
    errors=$((errors + 1))
  fi

  # model field: sonnet | opus | haiku | inherit | claude-*-*-*
  model=$(grep '^model:' "$file" | head -1 | sed 's/^model:[[:space:]]*//')
  if ! echo "$model" | grep -qE '^(sonnet|opus|haiku|inherit|claude-[a-z0-9-]+)$'; then
    echo "FAIL: $name_fromfile — model field invalid ('$model'); expected sonnet|opus|haiku|inherit|claude-*" >&2
    errors=$((errors + 1))
  fi

  # tools field: present and non-empty
  tools=$(grep '^tools:' "$file" | head -1 | sed 's/^tools:[[:space:]]*//')
  if [ -z "$tools" ]; then
    echo "FAIL: $name_fromfile — tools field missing or empty" >&2
    errors=$((errors + 1))
  fi

  # Body (post-frontmatter) ≤ 500 lines
  body_lines=$(awk '/^---$/{c++;next} c==2{print}' "$file" | wc -l)
  if [ "$body_lines" -gt 500 ]; then
    echo "FAIL: $name_fromfile — body is $body_lines lines (cap: 500). Extract detail out of the agent prompt" >&2
    errors=$((errors + 1))
  fi

  # Body must include at least one <constraint> block
  if ! grep -q '<constraint>' "$file"; then
    echo "FAIL: $name_fromfile — no <constraint> block in body" >&2
    errors=$((errors + 1))
  fi

  # Body must have `## Workflow` and `## Success Criteria`
  if ! grep -q '^## Workflow' "$file"; then
    echo "FAIL: $name_fromfile — missing '## Workflow' section" >&2
    errors=$((errors + 1))
  fi
  if ! grep -q '^## Success Criteria' "$file"; then
    echo "FAIL: $name_fromfile — missing '## Success Criteria' section" >&2
    errors=$((errors + 1))
  fi
done

if [ "$errors" -gt 0 ]; then
  echo "Guard FAILED: $errors structural errors" >&2
  exit 1
fi
echo "Guard PASSED: all agents structurally valid"
exit 0
