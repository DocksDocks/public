# Rust Dependency Workflow — cargo audit / cargo-outdated / cargo-deny

Ecosystem-specific layer to the parent SKILL.md (`../SKILL.md`). Parent covers severity triage, exposure filter, the pre-flight checks, split strategy, and cadence — they apply unchanged. Load this file when the project ships Rust.

## Audit & Upgrade Commands

```bash
# cargo audit (RustSec advisory DB)
cargo install cargo-audit
cargo audit                                  # Scan Cargo.lock
cargo audit --deny warnings                  # Treat unmaintained as error
cargo audit fix                              # Apply non-breaking fixes — needs `cargo install cargo-audit --features=fix`

# cargo-outdated (third-party)
cargo install cargo-outdated
cargo outdated                               # What's available
cargo outdated --root-deps-only              # Direct deps only

# cargo update (built-in; semver-range bounded)
cargo update                                 # Patch+minor within Cargo.toml
cargo update -p <pkg>                        # Single dep
cargo update -p <pkg> --precise X.Y.Z        # Pin a specific version

# cargo tree (built-in; transitive trace)
cargo tree -i <pkg>                          # Reverse-deps for <pkg>
cargo tree --duplicates                      # Find diamond-deps

# cargo-deny (license + advisory + ban policy)
cargo install cargo-deny
cargo deny check
```

Full check suite after every upgrade:

```bash
cargo fmt --check && cargo clippy -- -D warnings && cargo test && cargo audit
```

## Rust Major Upgrade Surprises

| Upgrade | Watch out for |
|---|---|
| Edition 2021 → 2024 | `extern` blocks must be `unsafe extern`; unsafe attributes (`#[unsafe(no_mangle)]`); tail-expression and `if let` temporary scope changes; RPIT lifetime capture rules; never-type fallback change; Rust-version-aware resolver (v3) |
| MSRV bumps | Many crates raise MSRV in 1.x.y; CI matrix must include the bumped floor |
| `hyper` 0.14 → 1.0 | `Body` trait split (`Incoming` for requests); `hyper-util` for client/server helpers |
| `axum` 0.7 → 0.8 | Path-param syntax `/:id` → `/{id}`; `#[async_trait]` removed from `FromRequest`; `Option<T>` extractor semantics |
| `reqwest` 0.11 → 0.12 | hyper 1.0 upgrade underneath; TLS feature flag renames — check `default-tls`/`rustls-tls` features |
| `clap` 3 → 4 | `Arg::new` signature; `derive` macros tightened; `App` → `Command` |
| `diesel` 1 → 2 | Async support is a separate crate (`diesel-async`); QueryDsl method renames |

## Exposure Filter — Rust Specifics

- **`[dev-dependencies]` / `[build-dependencies]`** — neither ships in the runtime binary. A vuln there is build-machine surface only.
- **Optional features.** Features in `Cargo.toml` are off by default unless `default` enables them. `cargo audit` reports the lockfile; a feature-gated vulnerable code-path may not even be compiled in.
- **`cfg(target_os = "...")`.** Platform-gated code may not reach your runtime. Read the advisory carefully.
- **Workspaces.** Root `Cargo.toml`'s `[workspace.dependencies]` propagates versions. Audit the root; lockfile is workspace-wide.

## Suppression Trap — BAD / GOOD

```rust
// BAD — silence clippy to ship the upgrade faster
#[allow(clippy::needless_return)]
fn compute() -> i32 { return 42; }
```

```rust
// GOOD — fix the lint
fn compute() -> i32 { 42 }
```

For genuinely justified suppressions, document the reason inline: `#[allow(clippy::too_many_arguments)] // FFI signature mirrors C ABI`. See `lint-no-suppressions`.

## Rust Gotchas

- **RustSec `RUSTSEC-*` IDs vs CVE.** cargo-audit reports both. RustSec IDs are sometimes filed before a CVE exists — react on either.
- **Yanked crates.** A yanked version on crates.io still resolves from a local lockfile. `cargo audit` flags yanked AND vulnerable. Unyank-then-upgrade isn't an option; you must update.
- **Edition is per-crate, MSRV is workspace-effective.** A 2021 crate can depend on a 2024 crate, but the lowest supported `rustc` must compile every crate in the workspace.
- **Commit `Cargo.lock` for every package** (the `cargo new` default). Consumers of a library resolve from its `Cargo.toml`, not its lockfile, so also CI-test libraries against the latest compatible deps. `cargo audit` on a library checks only its own lockfile, not the consumer's.
- **`[patch.crates-io]` for emergency fix-forward.** When upstream is slow to release a fix, point at a git fork in `[patch.crates-io]`. Document why inline; remove once upstream catches up.

## See Also

- `../SKILL.md` — universal playbook
- `lint-no-suppressions` skill — never silence clippy/rustc errors surfaced by an upgrade
- cargo-audit + RustSec: https://rustsec.org/
- Rust Edition Guide: https://doc.rust-lang.org/edition-guide/
- crates.io: https://crates.io
