# Data preservation — root → nodes relocation

Self-contained algorithm for `init` / `refresh` so no root section is lost when content moves into nodes. This is context-tree's own copy of the kit pattern: skill references stay one level deep, so a skill does not link into a sibling skill's files.

## Why per-section, not a byte-percentage

Relocation *adds* scaffolding — node headings, the `## tree` metadata, the root breadcrumb table. So the total bytes written are normally **≥100%** of the original root. A "fail if output dropped > X%" check is therefore backwards: it's too lenient (a whole lost section hides under the added scaffolding) and triggers on the wrong cases. The real invariant is **every original section is accounted for**. Byte-delta is kept only as a coarse *net-shrink* tripwire.

## Step-by-step

### 1. Inventory (before any write)

Copy every file the run will change (the root `AGENTS.md` and each existing node that `refresh` rewrites) into a backup directory OUTSIDE the repository, before the first write. Keep relative paths. Never use `git stash` as a backup: it reverts the working tree. Restore = copy back.

```bash
BACKUP="${XDG_STATE_HOME:-$HOME/.local/state}/context-tree/$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")-$(date +%Y%m%dT%H%M%S)"
mkdir -p "$BACKUP" && cp AGENTS.md "$BACKUP/AGENTS.md"    # repeat per changed node: mkdir -p "$BACKUP/<folder>" && cp <folder>/AGENTS.md "$BACKUP/<folder>/"
SOURCE_BEFORE="$BACKUP/AGENTS.md"
grep -nE '^#{1,3} ' "$SOURCE_BEFORE"        # the section list you must account for
wc -c < "$SOURCE_BEFORE"                     # baseline bytes
```

### 2. Per-section relocation table (the gate)

Render at the approval gate — alongside the node list — a row for EVERY section:

```text
| Section (root heading)        | Destination                  | Reason                         |
|-------------------------------|------------------------------|--------------------------------|
| ## Authoring skills           | plugins/docks/skills/AGENTS.md| folder-local authoring rules   |
| ## CI triggers                | .github/AGENTS.md            | CI config change axis          |
| ## Repository purpose         | KEEP in root                 | cross-cutting; not folder-local |
| ## Legacy notes               | DROP (user-confirmed)        | obsolete — explicit drop       |
```

Defaults: anything you cannot confidently route → **KEEP in root** (never silently move or drop). `DROP` requires an explicit user mark. A legacy CLAUDE.md never gets a row here: context-tree does not edit or delete it; `claude-md-migration` owns it. MIXED sections (part stays, part moves) split paragraph-by-paragraph; the unclassified remainder stays in root.

When a canonical plan is warranted, `plan-manager` reviews the proposal first. Then print the node list and this table, and ask for approval with the omp `ask` tool (the approval gate; the no-tool fallback is in the SKILL.md Intent gate). Write nothing until the user answers; silence is not consent; an ambiguous answer re-shows the tables. `--dry-run` and preview-only requests stop here permanently.

### 3. Two-phase write

**Phase A — nodes first, root untouched.** After the user approves, write each `<folder>/AGENTS.md`, copying the routed sections **verbatim** (reformatting heading levels / list markers is fine; rewording is not). Never write a `CLAUDE.md`. Confirm each AGENTS.md is non-empty and ≤500 lines. If you halt now, the root still has everything — worst case is duplication, which is recoverable. Loss is not.

**Phase B — prune root last.** Re-read the root and confirm it still matches `"$SOURCE_BEFORE"`. Show the exact lines to remove (the relocated sections) and ask for the second confirmation as a separate `ask` call. After the user confirms, delete them and update the `## Context tree` routing table. Never delete a section you cannot point to inside an already-written node.

### 4. Verification (fail loud)

```bash
# every original section heading must appear somewhere downstream.
# Strip the leading #s so a promoted/demoted heading (### → ##) still matches.
grep -E '^#{1,3} ' "$SOURCE_BEFORE" | sed -E 's/^#{1,3} +//' | while IFS= read -r h; do
  grep -rqF "$h" <written-nodes> AGENTS.md || echo "LOST SECTION: $h"
done
# net-shrink tripwire (expect total >= original because scaffolding was added)
before=$(wc -c < "$SOURCE_BEFORE")
after=$(cat AGENTS.md <every-written-node> | wc -c)
awk -v b="$before" -v a="$after" 'BEGIN{ if (a < b) print "NET SHRINK — investigate" }'
```

Any `LOST SECTION` (other than a user-confirmed `DROP`) or `NET SHRINK` line ⇒ restore `AGENTS.md` from `"$SOURCE_BEFORE"`, locate the content, and re-run. Do not report the tree complete with an open miss.

## Quick checklist

- [ ] Root and every changed node copied to `$BACKUP` (outside the repo) before any write
- [ ] Relocation table covers every `^#{1,3}` section; unclassified → KEEP in root
- [ ] Turn ended at the gate; nothing written before the user replied
- [ ] Phase A wrote nodes (no CLAUDE.md) + the node check passed BEFORE any root deletion
- [ ] Phase B pruned root only after the second confirmation
- [ ] Verification: zero `LOST SECTION` / `NET SHRINK` lines (DROPs excepted)
