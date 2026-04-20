#!/bin/bash
# Guard: validate SKILL.md structural correctness for every skill in a directory
# Usage: ./guard-skills.sh [path]   (default: ssot/.claude/skills)
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIR="${1:-$SCRIPT_DIR/ssot/.claude/skills}"
errors=0

[ -d "$DIR" ] || { echo "FAIL: skills dir not found: $DIR" >&2; exit 1; }

for skill_dir in "$DIR"/*/; do
  [ -d "$skill_dir" ] || continue
  skill_name=$(basename "$skill_dir")
  file="$skill_dir/SKILL.md"

  # SKILL.md must exist
  if [ ! -f "$file" ]; then
    echo "FAIL: $skill_name — SKILL.md missing" >&2
    errors=$((errors + 1))
    continue
  fi

  # Must open with `---` frontmatter fence on line 1
  first_line=$(head -n 1 "$file")
  if [ "$first_line" != "---" ]; then
    echo "FAIL: $skill_name — SKILL.md does not start with '---' frontmatter fence" >&2
    errors=$((errors + 1))
    continue
  fi

  # Must have a closing `---` fence
  fence_count=$(grep -c '^---$' "$file")
  if [ "$fence_count" -lt 2 ]; then
    echo "FAIL: $skill_name — frontmatter fence not closed (found $fence_count '---' lines)" >&2
    errors=$((errors + 1))
    continue
  fi

  # name field must match directory name
  name_field=$(grep '^name:' "$file" | head -1 | sed 's/^name:[[:space:]]*//')
  if [ "$name_field" != "$skill_name" ]; then
    echo "FAIL: $skill_name — name field ('$name_field') does not match directory name" >&2
    errors=$((errors + 1))
  fi

  # Third-party vendored skills opt into relaxed checks via `upstream:` frontmatter block
  has_upstream=$(grep -c '^upstream:' "$file")

  # description must be present, ≥10 chars, ≤1024 chars (universal);
  # start with "Use when" is a kit CSO rule, relaxed for upstream: skills
  desc=$(grep '^description:' "$file" | head -1 | sed 's/^description:[[:space:]]*//')
  desc_len=${#desc}
  if [ "$desc_len" -lt 10 ]; then
    echo "FAIL: $skill_name — description missing or too short ($desc_len chars)" >&2
    errors=$((errors + 1))
  elif [ "$desc_len" -gt 1024 ]; then
    echo "FAIL: $skill_name — description exceeds 1024 chars ($desc_len)" >&2
    errors=$((errors + 1))
  fi
  if [ "$has_upstream" -eq 0 ] && ! echo "$desc" | grep -qiE '^use when'; then
    echo "FAIL: $skill_name — description must start with 'Use when' (CSO)" >&2
    errors=$((errors + 1))
  fi

  # user-invocable field — kit convention, relaxed for upstream: skills
  if [ "$has_upstream" -eq 0 ] && ! grep -qE '^user-invocable:' "$file"; then
    echo "FAIL: $skill_name — user-invocable field missing" >&2
    errors=$((errors + 1))
  fi

  # metadata.updated — kit convention, relaxed for upstream: skills
  # (upstream.vendored_at serves the freshness purpose for vendored skills)
  if [ "$has_upstream" -eq 0 ]; then
    updated=$(awk '/^metadata:/{in_meta=1; next} in_meta && /^[a-z]/{in_meta=0} in_meta && /updated:/{print; exit}' "$file" \
              | sed 's/.*updated:[[:space:]]*"\{0,1\}\([0-9-]*\)"\{0,1\}.*/\1/')
    if ! echo "$updated" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
      echo "FAIL: $skill_name — metadata.updated missing or not in YYYY-MM-DD format (got: '$updated')" >&2
      errors=$((errors + 1))
    fi
  fi

  # Body (post-frontmatter) ≤ 500 lines
  body_lines=$(awk '/^---$/{c++;next} c==2{print}' "$file" | wc -l)
  if [ "$body_lines" -gt 500 ]; then
    echo "FAIL: $skill_name — body is $body_lines lines (cap: 500). Extract to references/" >&2
    errors=$((errors + 1))
  fi
done

if [ "$errors" -gt 0 ]; then
  echo "Guard FAILED: $errors structural errors" >&2
  exit 1
fi
echo "Guard PASSED: all skills structurally valid"
exit 0
