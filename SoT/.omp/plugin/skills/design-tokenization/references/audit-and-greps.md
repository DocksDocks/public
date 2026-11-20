# Audit Greps + Pre-merge Lock Script

Universal grep set used by the audit phase. Greps 1 and 2 are locked into the project's pre-commit / CI as the enforcement gate. Greps 3 and 4 have exemptions and false positives that need a human, so they stay audit-only.

## The Four Audit Greps

Run from the project root before proposing token names. Collect file:line evidence per category.

### 1. Hex literals in app code

```bash
grep -rEn '#[0-9a-fA-F]{3,8}\b' src/ \
  --include='*.tsx' --include='*.ts' --include='*.jsx' --include='*.js' \
  --include='*.vue' --include='*.svelte' \
  | grep -v 'index.css'
```

Excludes the canonical stylesheet (the only place hex is allowed). Every match is a violation.

### 2. Generic palette utilities used for semantic roles

```bash
grep -rEn '(bg|text|border)-(red|blue|green|yellow|purple|pink|orange|gray|slate|zinc|neutral|stone)-[0-9]+' src/ \
  --include='*.tsx' --include='*.ts'
```

Every match needs reclassification: is it semantic (`primary` / `destructive` / `success`) or brand (`whatsapp` / `stripe`)?

### 3. Alpha-modifier soft tints

```bash
grep -rEn '(bg|text|border)-[a-z-]+/[0-9]+' src/ \
  --include='*.tsx' --include='*.ts'
```

Hover/active states on the same base token are exempt (e.g., `hover:bg-primary/90`). Everything else is a soft-tint violation — convert to the X-tint triple.

### 4. Unpaired backgrounds (heuristic)

```bash
grep -rEn 'bg-(primary|secondary|destructive|success|warning|muted)' src/ \
  --include='*.tsx' --include='*.ts' \
  | grep -vE 'text-(on-|.*-foreground)'
```

Heuristic only — manually verify. False positives: decorative bars, dividers, progress fills (no text on top).

## Lock Script — Pre-commit Hook

Save the script as `.githooks/pre-commit-tokens`. Git runs only hooks with standard names, so call it from `.githooks/pre-commit` (create that file, or add the call line to an existing one) and wire once:

```bash
git config core.hooksPath .githooks
printf '#!/usr/bin/env bash\nexec .githooks/pre-commit-tokens\n' > .githooks/pre-commit  # skip if pre-commit exists; add the exec line instead
chmod +x .githooks/pre-commit .githooks/pre-commit-tokens
```

Mirror as a CI job — client hooks bypass with `--no-verify`.

```bash
#!/usr/bin/env bash
# Block hex/alpha drift in app code on commit
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

violations=0
check() {
  local label="$1"; local cmd="$2"
  local hits; hits=$(eval "$cmd" || true)
  if [ -n "$hits" ]; then
    echo "✗ $label" >&2
    echo "$hits" | sed 's/^/    /' >&2
    violations=$((violations + 1))
  fi
}

# Regexes are copied from audit greps 1 and 2 above; keep them identical.
check "Hex literal in app code" \
  "grep -rEn '#[0-9a-fA-F]{3,8}\\b' src/ --include='*.tsx' --include='*.ts' --include='*.jsx' --include='*.js' --include='*.vue' --include='*.svelte' | grep -v 'index.css'"

check "Generic palette used for semantic role" \
  "grep -rEn '(bg|text|border)-(red|blue|green|yellow|purple|pink|orange|gray|slate|zinc|neutral|stone)-[0-9]+' src/ --include='*.tsx' --include='*.ts'"

[ "$violations" -gt 0 ] && exit 1
exit 0
```

## CI Variant (GitHub Actions)

```yaml
- name: Token discipline
  run: bash .githooks/pre-commit-tokens
```

Run it on staged-against-main rather than the whole tree if a project has legacy code that pre-dates the migration — keeps the gate scoped to new violations only.
