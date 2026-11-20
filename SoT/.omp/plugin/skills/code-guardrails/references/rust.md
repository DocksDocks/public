# Rust guardrails

## Contents

- [Detect](#detect)
- [Recommended config](#recommended-config)
- [Rules that catch raw values](#rules-that-catch-raw-values)
- [Constant map](#constant-map)
- [Verify](#verify)
- [Sources](#sources)

## Detect

- Inspect each package's `Cargo.toml` for `[lints]` and `[lints.clippy]`.
- Inspect the root `Cargo.toml` for `[workspace.lints]` and member manifests for `[lints] workspace = true`.
- Inspect `clippy.toml` or `.clippy.toml` for existing Clippy options.
- Inspect crate roots for `#![warn(...)]` and other crate-level lint settings.
- Check whether `cargo clippy` runs before you propose installing Clippy. Ask before installing an absent tool.

## Recommended config

Merge these entries into the existing manifest. Keep existing rules and add missing ones. Never lower a stricter lint level. Use the first layout for one package:

```toml
# Single-package Cargo.toml
[lints.clippy]
pedantic = { level = "warn", priority = -1 }
unwrap_used = "warn"
expect_used = "warn"
todo = "warn"
unimplemented = "warn"
dbg_macro = "warn"
decimal_literal_representation = "warn"
```

Use the second layout for a workspace. Merge these entries into the root manifest:

```toml
# Workspace root Cargo.toml
[workspace.lints.clippy]
pedantic = { level = "warn", priority = -1 }
unwrap_used = "warn"
expect_used = "warn"
todo = "warn"
unimplemented = "warn"
dbg_macro = "warn"
decimal_literal_representation = "warn"
```

Add this entry to each member manifest that has no `[lints]` table, including a root package if present:

```toml
# Each member Cargo.toml
[lints]
workspace = true
```

Cargo does not merge `workspace = true` with other lint keys in the same member. A member that already has `[lints.clippy]` or `[lints.rust]` needs one of these paths:

- **All members can share one set:** move each member's lint levels into `[workspace.lints]`. When two members set the same lint differently, keep the stricter level (`forbid`, then `deny`, then `warn`, then `allow`). Then replace the member tables with `workspace = true`.
- **A member needs different levels:** keep that member's own tables. Add the missing reference rules to them directly, and do not add `workspace = true` to that member.

Report each member you changed and the path you used.

A negative `pedantic` priority lets individually configured lints take precedence. Choose restriction lints individually; do not enable the whole `restriction` group. Preserve existing `clippy.toml` options instead of replacing that file. Report each rule added or changed and any stricter setting you preserved.

## Rules that catch raw values

Clippy has **no magic-number lint** that rejects all unexplained numbers or finds repeated domain values. Use the language-agnostic check in [`SKILL.md` → Find scattered values](../SKILL.md#find-scattered-values).

| Rule | Catches | Limits |
|---|---|---|
| `clippy::unreadable_literal` | Long numeric literals without grouping underscores. | Readability only; does not detect duplicated limits or units. `pedantic` enables it. |
| `clippy::decimal_literal_representation` | Decimal literals with a clearer nondecimal representation, such as a large bit mask. | Does not identify domain constants or repeated values. |
| `clippy::approx_constant` | Floating-point literals approximating standard mathematical constants. | Does not detect arbitrary application constants. Clippy enables this correctness lint by default. |

## Constant map

Keep `pub const` values in their owning domain module, such as `src/limits.rs`.
Do not create a catch-all constants module.
Derive related values from one definition.
Name units (`UPLOAD_LIMIT_BYTES`) or use a newtype.
Route newtype design to `type-safety-discipline`.
Use `std::time::Duration` for durations instead of untyped time counts.

```rust
// BAD — copied byte limits and a raw delay can drift apart.
fn accepts_upload(size_bytes: u64) -> bool {
    size_bytes <= 8 * 1024 * 1024
}
fn retry_delay() -> u64 { 5 }
```

```rust
// GOOD — src/limits.rs owns the limit and its unit.
use std::time::Duration;

pub const KIB: u64 = 1024;
pub const MIB: u64 = 1024 * KIB;
pub const UPLOAD_LIMIT_BYTES: u64 = 8 * MIB;
pub const RETRY_DELAY: Duration = Duration::from_secs(5);

// Import UPLOAD_LIMIT_BYTES and RETRY_DELAY from the owning module at call sites.
```

Use production constants for test inputs. Use a literal expected value when the test checks the constant's value.
Do not compare a constant to itself.

## Verify

Run `cargo clippy --all-targets --all-features -- -D warnings` for one package. Run `cargo clippy --workspace --all-targets --all-features -- -D warnings` from a workspace root to cover every member. The `-D warnings` flag also rejects rustc warnings.

## Sources

- [Cargo manifest lint tables and priority](https://doc.rust-lang.org/cargo/reference/manifest.html#the-lints-section)
- [Cargo workspace lint inheritance](https://doc.rust-lang.org/cargo/reference/workspaces.html#the-lints-table)
- [Cargo RFC 3389: `workspace = true` excludes other lint keys](https://rust-lang.github.io/rfcs/3389-manifest-lint.html)
- [Clippy configuration file and manifest lint settings](https://doc.rust-lang.org/clippy/configuration.html)
- [Clippy groups, restriction policy, and warning flags](https://doc.rust-lang.org/clippy/usage.html)
- [Cargo target and feature selection](https://doc.rust-lang.org/cargo/commands/cargo-check.html)
- [Rust crate-wide lint attributes](https://doc.rust-lang.org/rustc/lints/levels.html#via-an-attribute)
- [Clippy `unwrap_used`](https://rust-lang.github.io/rust-clippy/master/#unwrap_used), [`expect_used`](https://rust-lang.github.io/rust-clippy/master/#expect_used), [`todo`](https://rust-lang.github.io/rust-clippy/master/#todo), [`unimplemented`](https://rust-lang.github.io/rust-clippy/master/#unimplemented), [`dbg_macro`](https://rust-lang.github.io/rust-clippy/master/#dbg_macro)
- [Clippy `unreadable_literal`](https://rust-lang.github.io/rust-clippy/master/#unreadable_literal), [`decimal_literal_representation`](https://rust-lang.github.io/rust-clippy/master/#decimal_literal_representation), [`approx_constant`](https://rust-lang.github.io/rust-clippy/master/#approx_constant)
- [`Duration::from_secs` constant constructor](https://doc.rust-lang.org/std/time/struct.Duration.html#method.from_secs)
