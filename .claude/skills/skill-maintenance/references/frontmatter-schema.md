# SKILL.md Frontmatter Schema

## Critical Constraints

- `name` MUST match the directory name exactly (kebab-case). Validators check this.
- `user-invocable: false` is required for all kit skills (not vendored).
- `metadata.updated` MUST be updated when `source_files` content changes substantively.

## Full Schema

```yaml
---
name: <string>                  # kebab-case; matches parent directory name
description: <string>           # CSO-compliant; "Use when…"; ≤1024 chars; ≥5 project identifiers
user-invocable: false           # always false for kit skills
metadata:
  source_files:                 # files whose patterns this skill documents
    - path: <string>            # relative path from project root
      lines: "<N-M>"            # optional: "61-104" reduces cold-read scope
  updated: "<YYYY-MM-DD>"       # ISO date of last substantive update
---
```

## Vendored Third-Party Skill — Additional Block

```yaml
upstream:
  source: https://github.com/<owner>/<repo>    # canonical upstream URL
  license: <SPDX-id>                           # e.g. MIT, Apache-2.0
  vendored_at: "<YYYY-MM-DD>"                  # date of vendoring
```

When `upstream:` is present, `guard-skills.sh` relaxes:
- CSO "Use when" start-prefix requirement
- `user-invocable` requirement
- `metadata.updated` staleness check

Still enforced: fenced frontmatter, name-matches-directory, description length ≥ 20 chars, body ≤ 500 lines.

## Field Semantics

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `name` | Yes | string | Must match directory name |
| `description` | Yes | string | CSO-compliant trigger condition description |
| `user-invocable` | Yes | boolean | Always `false` for kit skills |
| `metadata.source_files` | Yes | array | Empty `[]` for meta-skills with no codebase source |
| `metadata.source_files[].path` | Yes | string | Relative to project root |
| `metadata.source_files[].lines` | No | string | `"N-M"` or `"N"` |
| `metadata.updated` | Yes | string | ISO 8601 date: `"YYYY-MM-DD"` |
| `upstream.source` | Conditional | string | Required when vendoring |
| `upstream.license` | Conditional | string | Required when vendoring |
| `upstream.vendored_at` | Conditional | string | Required when vendoring |

## Directory Layout Convention

```
.claude/skills/
└── <skill-name>/            ← matches `name:` field exactly
    ├── SKILL.md             ← frontmatter + body (≤500 lines)
    └── references/
        ├── <topic-a>.md     ← 30-150 lines
        └── <topic-b>.md     ← 30-150 lines
```

## Gotchas

- Frontmatter MUST be fenced with `---` delimiters. A bare YAML block without delimiters fails discovery.
- `name` mismatch between frontmatter and directory causes `guard-skills.sh` to fail validation.
- `source_files` paths are relative to the project root — not to the skill directory. Use `lib/claude.sh`, not `../../lib/claude.sh`.
- `metadata.source_files: []` (empty array) is valid for meta-skills. Do not omit the key entirely.
