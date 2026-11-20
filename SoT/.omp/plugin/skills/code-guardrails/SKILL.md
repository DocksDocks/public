---
name: code-guardrails
description: "Use when setting up strict linter rules for TypeScript (oxlint, anti-slop), Rust (clippy), Swift (SwiftLint), Python (Ruff), or Bash (ShellCheck), or when code repeats raw numbers, strings, or test data instead of one named constant. Adds missing rules to the existing lint config, maps derived constants to one owner, and reports each change. Not for a lint error that tempts a suppression (use lint-no-suppressions), naming or comments (use code-clarity), or repo-wide sweeps (use refactor)."
user-invocable: true
metadata:
  pattern: tool-wrapper
  updated: "2026-10-23"
  content_hash: "edb40fc49d952999cc51e8dcb7515e66ff7c17d813bee9a3388a1d71464a019a"
---

# Code Guardrails

Agents often write the same raw value in many places, copy a value that another
module already owns, or skip lint rules that would catch low-quality code. This
skill does two jobs:

1. It adds strict linter rules to the project, so a tool rejects the problem on every run.
2. It applies the rules that no linter can check: one mapped source for each value,
   constants built from other constants, test data, and data read from its owner.

<constraint>
Each value has one owner. Before you write a literal that has a meaning, search
the project for an existing constant, config field, enum, or generated type that
holds it. If one exists, import it. If none exists, define it once in the module
that owns that domain, and build related values from it (`MIB = 1024 * KIB`, not
`1048576`). A second definition drifts: one copy changes, the other copy does not,
and the bug appears only at run time.
</constraint>

<constraint>
When the project has a lint config, change it only by adding rules. Do not loosen,
remove, or reorder an existing rule, and do not change the linter or formatter the
project chose. When a language has no linter, ask the user before you install the
tool from the reference. After approval, create its config from the reference. Ask
before any network step, such as the anti-slop installer. Report every rule you add.
A silent dependency or tool change is a change the user did not approve.
</constraint>

<constraint>
Keep the raw-number lint rule on in test files. In tests, import production
constants for inputs and configuration. When a test checks a constant or a value
computed from constants, put the expected result in a named literal constant.
An assertion such as `expect(MIB).toBe(1024 * KIB)` repeats the code under test,
so it passes even when the definition is wrong. A test-file exemption lets a copied
limit such as `fileOfSize(10485761)` pass lint and drift from production.
</constraint>

## When to use

- A project has no linter, or its linter runs with default rules only.
- Code repeats the same number, string, unit, limit, path, URL, key, or error code.
- A value is defined in two places, or a module copies a default that another module owns.
- A derived value is written as its computed result (`86400`, `1048576`).
- Tests repeat magic values, or assert a constant against itself.

Not for these tasks:

| Task | Use |
|---|---|
| A lint error tempts you to add a suppression comment | `lint-no-suppressions` |
| Unclear names, comments, or function boundaries | `code-clarity` |
| A closed set of states needs a union, enum, or newtype | `type-safety-discipline` |
| A repo-wide pass over dead code and duplicated blocks | `refactor` |
| A review of a diff for bugs and security | `code-review` |

## Workflow

1. **Detect.** List the languages in the project and the lint config for each one.
   Read the matching reference in the table below.
2. **Add missing rules.** Compare the existing config with the reference config.
   Add the missing rules. Keep every existing rule that is stricter.
3. **Run the linter.** Use the verify command in the reference. Fix each finding in
   the code. If a fix seems impossible, follow `lint-no-suppressions`.
4. **Find scattered values.** Run the check in "Find scattered values". Linters miss
   repeated strings and most repeated numbers.
5. **Map the values.** Move each repeated or copied value to its owner. Replace every
   use with an import.
6. **Report.** Use the report format below.

| Language | Linter | Reference |
|---|---|---|
| TypeScript, JavaScript | oxlint, plus the upstream anti-slop ruleset | [`references/typescript.md`](references/typescript.md) |
| Rust | clippy (`[lints.clippy]` or `[workspace.lints.clippy]`) | [`references/rust.md`](references/rust.md) |
| Swift | SwiftLint | [`references/swift.md`](references/swift.md) |
| Python | Ruff | [`references/python.md`](references/python.md) |
| Bash, sh | ShellCheck | [`references/bash.md`](references/bash.md) |

Formatters such as oxfmt, Prettier, rustfmt, swift-format, `ruff format`, and shfmt
change layout only. They do not find raw values or copied data.

## The constant map

A constant map is the set of modules that own the project's named values. Each
domain has one module, and every other file imports from it.

| Value kind | Examples | Owner |
|---|---|---|
| Sizes and units | `KIB`, `MIB`, `MAX_UPLOAD_BYTES` | A units or limits module |
| Durations | `REQUEST_TIMEOUT_MS`, `CACHE_TTL` | The module that uses the timer, or a shared limits module |
| Closed sets of states | `"pending"`, `"active"`, `"cancelled"` | A union or enum (`type-safety-discipline`) |
| External names | env var names, header names, API paths, queue names | The boundary module that reads or sends them |
| Runtime settings | ports, URLs, feature flags | One config module that parses the environment once |
| Messages and codes | error codes, user-facing text keys | The error module or the text catalog |
| Generated contracts | API schemas, database types | The generated file; never copy its values by hand |

Rules for the map:

- Put the unit in the name: `TIMEOUT_MS`, `MAX_BODY_BYTES`, `RETRY_DELAY_S`. A bare
  `TIMEOUT = 30` makes the reader guess seconds or milliseconds.
- Build derived values from base values. A reader can check `1024 * KIB` in one look.
- Use a name that states the meaning, not the value. `MAX_RETRIES = 3` is useful;
  `THREE = 3` is not.
- Group by domain. A single `constants` file for the whole project becomes a second
  place that every change must touch. Use it only in a small project.
- Do not name values that have no meaning beyond themselves: `0`, `1`, `-1` as
  loop bounds or indexes, and `2` in `x / 2` for a midpoint.

```ts
// BAD — raw results, no units, and a second copy of the limit in another file
if (file.size > 10485760) throw new Error("File too large");
setTimeout(retry, 30000);
// src/api/upload.ts repeats: const limit = 10485760;

// GOOD — one owner, derived values, units in the names, imports elsewhere
// src/limits.ts
export const KIB = 1024;
export const MIB = 1024 * KIB;
export const MAX_UPLOAD_BYTES = 10 * MIB;
export const RETRY_DELAY_MS = 30 * 1000;

// src/api/upload.ts
import { MAX_UPLOAD_BYTES } from "../limits";
if (file.size > MAX_UPLOAD_BYTES) throw new UploadTooLargeError(file.size);
```

Each reference shows the same model in the idiom of its language.

## Read data from its owner

Copied data is the same defect as a copied constant. Check these cases:

- **Configuration:** parse the environment once in the config module. Other code
  imports the parsed value. It does not call `process.env`, `std::env::var`,
  `os.environ`, or `ProcessInfo` again with its own default.
- **Defaults:** a default lives next to the setting it belongs to. Do not repeat it
  in the caller, the command-line parser, and the documentation.
- **API and database data:** use the generated or declared type. Do not write a
  second hand-made copy of a schema, a column list, or a status list.
- **Values that the system computes:** read them from the source, such as a version
  from the package manifest, not from a copied string.

## Find scattered values

Run these checks from the repository root. They list values that appear in two
or more places, with the count first. Change the `--include` globs to match the
project languages, and add `--exclude-dir` for vendored or generated folders.

```bash
# Numbers that appear 2 or more times: hexadecimal, binary, and octal literals
# as whole values, and decimal numbers with 2 or more characters.
# Single digits are left out because they are mostly counters and indexes.
grep -rhowE --include='*.ts' --include='*.rs' --include='*.swift' --include='*.py' --include='*.sh' \
  --exclude-dir=node_modules --exclude-dir=target --exclude-dir=.git \
  '0[xXbBoO][0-9a-fA-F_]+|[0-9][0-9_.]+' . | sort | uniq -c | sort -rn | awk '$1 > 1'

# Quoted strings of 4 or more characters that appear 2 or more times.
grep -rhoE --include='*.ts' --include='*.rs' --include='*.swift' --include='*.py' --include='*.sh' \
  --exclude-dir=node_modules --exclude-dir=target --exclude-dir=.git \
  "[\"'][^\"'\$]{4,}[\"']" . | sort | uniq -c | sort -rn | awk '$1 > 1'
```

The output is a list of candidates, not a list of defects. The checks include test
files, so they also find a production value copied into a test constant. Short
values such as `10`, `30`, or `60` produce many candidates; check each one that
could be a limit, timeout, or size. Find its locations with `grep -rnw '<value>' .`
and decide:

| Finding | Action |
|---|---|
| Same meaning in 2 or more places | Define one constant in the owning module and import it |
| A computed result such as `86400` or `1048576` | Replace it with a derived constant |
| Different meanings that share a value | Keep them apart, with two names |
| Log text, test names, or one-time messages | Leave them |

## Test data

- Import production constants for inputs, limits, and configuration. If the limit
  changes, the test follows it.
- Put each expected result in a named constant when the test checks a constant or
  a calculation, such as `EXPECTED_MAX_UPLOAD_BYTES = 10_485_760`. This is the only
  place a copied raw value is the correct choice, and the name says why it is there.
- Keep the raw-number rule on in test files. Linters skip a literal that initializes
  a named constant, so the rule still rejects inline values such as `10485761`.
  SwiftLint always skips test code; for Swift tests, rely on the scan above.
- Put shared fixtures and builders in one test-support module. Do not copy the same
  sample object into every test file.
- Name a test value by its role: `validEmail`, `expiredToken`, not `data1`.

```ts
// BAD — tautology: the expected value repeats the definition
expect(MAX_UPLOAD_BYTES).toBe(10 * MIB);
// BAD — a copy of the production limit that drifts when the limit changes
expect(() => upload(fileOfSize(10485761))).toThrow();

// GOOD — named literal for the definition check, import for the behavior check
const EXPECTED_MAX_UPLOAD_BYTES = 10_485_760;
expect(MAX_UPLOAD_BYTES).toBe(EXPECTED_MAX_UPLOAD_BYTES);
expect(() => upload(fileOfSize(MAX_UPLOAD_BYTES + 1))).toThrow(UploadTooLargeError);
```

## Gotchas

| Mistake | Correction |
|---|---|
| Add a new `constants` file while one already exists | Search first; extend the existing owner |
| Turn off a lint rule for the whole project to fix one file | Fix the code, or follow `lint-no-suppressions` |
| Replace ESLint or Prettier with oxlint or oxfmt without a request | Add the rule to the tool the project uses; ask before a migration |
| Name every literal, including `0` and `1` in loops | Name values that carry a meaning only |
| Assume Rust and Bash linters catch raw values | They have no such rule; run "Find scattered values" |
| Turn off the raw-number rule for test files | Keep it on; name expected literals as constants |

## Report

End with this report, one row per change:

```markdown
| Change | File | Reason |
|---|---|---|
| Added `eslint/no-magic-numbers` | `.oxlintrc.json` | No rule caught raw numbers |
| Moved `MAX_UPLOAD_BYTES` to `src/limits.ts` | `src/api/upload.ts`, `src/ui/drop.ts` | Two copies of one limit |
```

Then list the tools you did not install and the questions for the user.

## Verification

- Run the verify command from each language reference. It must pass with the new rules.
- Run the two checks in "Find scattered values" again. Each remaining repeated value
  must have a reason in the report.
- Run the project tests. A moved constant must not change behavior.

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/docks repository. Use the docks `report-skill-issue` skill for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and its plugin version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
