# Skill Maintenance References

## Contents

- [Loader Warnings](#loader-warnings)
- [Description Budgeting](#description-budgeting)
- [YAML-Safe Frontmatter](#yaml-safe-frontmatter)
- [Source-File Targeting](#source-file-targeting)
- [Idempotent Update Algorithm](#idempotent-update-algorithm)
- [Local `skill-maintenance` Decision Table](#local-skill-maintenance-decision-table)
- [Validation Without Project Scripts](#validation-without-project-scripts)

Use this file for the details that should not crowd the `SKILL.md` body. Keep
the active workflow in `SKILL.md`; load this reference when validating a tricky
skill set or cleaning up local maintenance skills.

## Loader Warnings

The first two rows come from a loader that validates frontmatter, such as the
omp `agent-plugins` loader. omp lists a project skill with invalid YAML or a
description over 1024 chars without a warning, so check project skills with
`docks-kit skill guard` and the YAML parse in
[Validation Without Project Scripts](#validation-without-project-scripts).

| Warning | Likely cause | Fix |
|---|---|---|
| `invalid YAML: mapping values are not allowed` | Unquoted `: ` inside a frontmatter scalar | Quote `description` or use a block scalar |
| `invalid description: exceeds maximum length of 1024 characters` | Description is carrying body/reference detail | Keep trigger words, move detail below frontmatter |
| Skill missing from `omp skill list --json` | Bad frontmatter, wrong skill root, or plugin not installed | Validate YAML, list roots, run `omp plugin list` |
| A `.claude/skills` copy wins over the `.agents/skills` copy | omp loads `.claude/skills` before `.agents/skills`; the first copy keeps the bare name | Validate canonical `.agents/skills` content; remove or sync the legacy copy |
| omp lists a `<namespace>/<name>` alias or a collision warning | A project-local skill and a plugin skill share a name but differ | Compare content, keep only project-specific local rules |

## Description Budgeting

Descriptions are always loaded into the session skill listing. Treat 1024 chars
as the hard ceiling and 500 chars as the practical target. Put the highest-signal
trigger first:

1. User phrase or command that should trigger the skill.
2. File paths, env vars, exported names, CLI commands, routes, table names, or
   error classes specific to the project.
3. One exclusion clause when another skill would otherwise overlap.

Move everything else to the body or `references/`. A description is not a table
of contents.

## YAML-Safe Frontmatter

Prefer this shape:

```yaml
---
name: checkout-context
description: "Use when editing checkout routes, STRIPE_WEBHOOK_SECRET handling, CartExpiredError, order state transitions, or pnpm seed:orders fixtures. Not for generic React UI work."
user-invocable: false
metadata:
  pattern: context
  source_files:
    - app/routes/checkout.ts
    - app/services/orders.ts
  updated: "2026-05-26"
---
```

Rules:

- Quote descriptions by default.
- Keep `name` equal to the directory name.
- Use `metadata.source_files` when a skill is tied to code paths.
- Use `references/` for long examples, schemas, or subsystem notes.

## Source-File Targeting

When a diff is available, map changed files to skills in this order:

1. Exact match in `metadata.source_files`.
2. Parent directory match in `metadata.source_files`.
3. Path or symbol mentioned in `SKILL.md`.
4. Path or symbol mentioned in `references/*.md`.
5. No match: report that no skill needs maintenance.

If one changed file touches multiple skills, update all affected skills. If one
skill references deleted source files, either replace the path with the new
location or remove the stale claim.

## Idempotent Update Algorithm

Use this algorithm to avoid timestamp churn:

1. Read original `SKILL.md` plus direct `references/*.md`.
2. Make the smallest content update needed.
3. Normalize original and new content by trimming trailing whitespace and
   collapsing repeated blank lines.
4. If normalized content is equal, discard the edit.
5. If normalized content differs, re-sync metadata with the project's
   content-hash tooling if it has one; otherwise update `metadata.updated` to
   today's date.
6. Re-run the project validator or loader smoke test.

## Local `skill-maintenance` Decision Table

| Local content | docks-kit kit plugin available | Decision |
|---|---|---|
| Generic rules only | yes | Propose removal; delete only after user approval |
| Generic plus stale rules | yes | Propose removal; note stale rules |
| Project-specific checks | yes | Keep local or rename to project-specific maintenance |
| Project-specific checks | no | Keep local |
| Invalid YAML or overlong description | any | Fix first, then decide whether it is still needed |

Do not delete by default. A project-local skill may encode conventions that are
not appropriate for the shared plugin.

## Validation Without Project Scripts

When a project has no validator, use direct inspection:

```bash
find .agents/skills .claude/skills -name SKILL.md -maxdepth 3 -print 2>/dev/null
# omp loader check: read the "warnings" array; a missing skill is not in "skills".
# It does not check YAML validity or the 1024 cap of a project skill; only the
# agent-plugins loader validates name and description. docks-kit skill guard
# checks the cap on the parsed description value (block scalars too) and rejects
# a YAML alias, anchor, or tag there; check YAML syntax with the parser command
# below.
omp skill list --json
```

If the project has Node dependencies and the `yaml` package installed, parse
frontmatter with the same family of parser used by the docks-kit content checks:

```bash
node -e 'const fs=require("fs"); const {parseDocument}=require("yaml"); const s=fs.readFileSync(process.argv[1],"utf8"); const m=s.match(/^---\n([\s\S]*?)\n---/); const d=parseDocument(m?.[1]||""); if(d.errors.length){console.error(d.errors.map(e=>e.message).join("\n")); process.exit(1)} console.log("frontmatter ok")' .agents/skills/example/SKILL.md
```

When no parser is installed, do not pretend a grep is equivalent to YAML parsing.
Use grep only to triage likely hazards, then tell the user what parser-backed
validation is missing.
