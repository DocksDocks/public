# Bash guardrails

## Contents

- [Detect](#detect)
- [Recommended config](#recommended-config)
- [Rules that catch raw values](#rules-that-catch-raw-values)
- [Constant map](#constant-map)
- [Verify](#verify)
- [Sources](#sources)

## Detect

- Find `.shellcheckrc` or `shellcheckrc` beside each script, then search its parent directories. ShellCheck uses the first file it finds.
- If no parent file exists, check `~/.shellcheckrc`, then `$XDG_CONFIG_HOME/shellcheckrc`.
- Check matching `.editorconfig` entries and `SHELLCHECK_OPTS` for other ShellCheck settings.
- Find CI steps that run `shellcheck` and check their flags against the configuration.
- Check `.editorconfig` and shfmt settings for layout. Shfmt formats code; it does not replace ShellCheck.
- Ask before installing ShellCheck if the project has no installed tool.

## Recommended config

Merge these entries into the existing `.shellcheckrc`. Keep existing checks and stricter settings. Add only missing entries; do not replace the file. Apply this example to trusted source trees because `external-sources=true` opens sourced files.

```ini
# Follow local source statements when checking trusted project scripts.
external-sources=true
# Report missing fallback branches in case statements.
enable=add-default-case
# Make nonempty-string checks explicit.
enable=avoid-nullary-conditions
# Report additional masked command failures.
enable=check-extra-masked-returns
# Report functions that run without expected errexit behavior.
enable=check-set-e-suppressed
# Catch misspelled uppercase variable names.
enable=check-unassigned-uppercase
# Use the shell builtin to locate commands.
enable=deprecate-which
# Quote values even when their present contents look safe.
enable=quote-safe-variables
# Mark variable boundaries with braces.
enable=require-variable-braces
```

Do not enable `require-double-brackets` for a mixed-shell tree; POSIX `sh` does not support `[[ ... ]]`. Do not set `shell=bash` globally when scripts include other dialects. ShellCheck reads shebangs and recognized extensions. Set `shell=bash` only for Bash files without a usable shebang, in a scoped configuration. Check available optional rules with `(verify: shellcheck --list-optional)`; later tool releases may add rules. Do not use `enable=all`; optional checks can conflict.

## Rules that catch raw values

ShellCheck has no rule that detects repeated numeric or string literals across scripts. Run the language-agnostic check in `SKILL.md` under `## Find scattered values`.

| Rule | Catches | Limits |
|---|---|---|
| `add-default-case` (SC2249) | Missing `case` fallback | Does not find copied case labels or constants. |
| `avoid-nullary-conditions` (SC2243) | Implicit nonempty-string tests | Does not infer whether a constant belongs in that test. |
| `check-extra-masked-returns` (SC2312) | Failures hidden inside command arguments | Does not check repeated limits. |
| `check-set-e-suppressed` (SC2310) | Function calls that suppress `set -e` | Does not check repeated values. |
| `check-unassigned-uppercase` (SC2154) | Possibly unassigned uppercase names | Does not discover duplicated assigned values. |
| `deprecate-which` (SC2230) | Nonstandard `which` calls | Does not check copied paths. |
| `quote-safe-variables` (SC2248) | Unquoted safe-looking expansions | Does not check literal ownership. |
| `require-variable-braces` (SC2250) | Expansions without braces | Does not check literal ownership. |

## Constant map

Use `readonly` names near the top of one script for local values. Source one owning `constants.sh` or `lib/config.sh` when scripts share values. Derive units with `$(( ... ))`. Include units in names, such as `MAX_BYTES` and `TIMEOUT_SECONDS`. Put `set -euo pipefail` after the Bash shebang in scripts that use Bash.

```bash
#!/usr/bin/env bash
set -euo pipefail
file_bytes=${1:?}
backup_bytes=${2:?}
# BAD — the byte limit and output path have separate copies.
if (( file_bytes > 8388608 )); then
  printf '%s\n' "$HOME/cache/output.bin"
fi
if (( backup_bytes > 8388608 )); then
  printf '%s\n' "$HOME/cache/output.bin"
fi
```

```bash
#!/usr/bin/env bash
set -euo pipefail
file_bytes=${1:?}
backup_bytes=${2:?}
# GOOD — both comparisons use the owning byte limit.
readonly KIB=1024
readonly MIB=$((KIB * KIB))
readonly MAX_BYTES=$((8 * MIB))
readonly ARTIFACT_PATH="${HOME}/cache/output.bin"
if (( file_bytes > MAX_BYTES )); then
  printf '%s\n' "${ARTIFACT_PATH}"
fi
if (( backup_bytes > MAX_BYTES )); then
  printf '%s\n' "${ARTIFACT_PATH}"
fi
```

## Verify

Adjust the pruned directory names to match the repository. Add extensionless Bash scripts to the selected paths. Run this command from the repository root:

```bash
find . -type d \( -name .git -o -name node_modules -o -name vendor -o -name third_party \) -prune -o -type f \( -name '*.sh' -o -name '*.bash' \) -exec shellcheck {} +
```

Record every rule that you add to the existing configuration. Report any differences between local and CI options.

## Sources

- [ShellCheck manual: options, configuration lookup, environment variables, and sourced files](https://github.com/koalaman/shellcheck/blob/master/shellcheck.1.md)
- [ShellCheck optional checks: names, opt-in behavior, and conflicts](https://www.shellcheck.net/wiki/optional)
- [SC2249: default cases](https://www.shellcheck.net/wiki/SC2249); [SC2243: explicit string tests](https://www.shellcheck.net/wiki/SC2243)
- [SC2312: masked returns](https://www.shellcheck.net/wiki/SC2312); [SC2310: suppressed errexit](https://www.shellcheck.net/wiki/SC2310)
- [SC2154: unassigned variables](https://www.shellcheck.net/wiki/SC2154); [SC2230: command lookup](https://www.shellcheck.net/wiki/SC2230)
- [SC2248: quotes](https://www.shellcheck.net/wiki/SC2248); [SC2250: braces](https://www.shellcheck.net/wiki/SC2250)
- [shfmt manual: EditorConfig and formatting](https://github.com/mvdan/sh/blob/master/cmd/shfmt/shfmt.1.scd)
