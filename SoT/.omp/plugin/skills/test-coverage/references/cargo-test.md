# cargo test Conventions

## Contents

- [Detection](#detection)
- [File Layout — Unit vs Integration](#file-layout-unit-vs-integration)
- [Assertion Idioms](#assertion-idioms)
- [Async Tests](#async-tests)
- [Mocking](#mocking)
- [Running](#running)
- [Coverage](#coverage)
- [Common Gotchas](#common-gotchas)
- [Perf Tuning & Parallelism](#perf-tuning-parallelism)
- [Coverage Scope — What NOT to Test](#coverage-scope-what-not-to-test)
- [See Also](#see-also)

Per-framework expansion of the parent SKILL.md. Load when the project's test runner is `cargo test`. Pairs with the universal 6-step procedure and `<constraint>` rules in `../SKILL.md`.

## Detection

| Signal | Confirms cargo test |
|---|---|
| `Cargo.toml` present | Yes |
| `[dev-dependencies]` section | Strong signal |
| `tests/` directory at crate root | Integration tests |
| `#[cfg(test)] mod tests { ... }` in source files | Unit tests inline |

## File Layout — Unit vs Integration

```
my_crate/
├── Cargo.toml
├── src/
│   ├── lib.rs                 # public API
│   └── parser.rs              # contains `#[cfg(test)] mod tests` for unit tests
└── tests/
    └── integration_test.rs    # integration tests (linked as separate binary)
```

Unit tests live INSIDE the source file they test — access to private items. Integration tests live in `tests/` and treat the crate as an external user would.

## Assertion Idioms

```rust
// src/parser.rs
pub fn parse_duration(s: &str) -> Result<u64, ParseError> {
    // ...
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hours_and_minutes() {
        assert_eq!(parse_duration("1h30m"), Ok(5_400_000));
    }

    #[test]
    fn rejects_invalid_input() {
        let err = parse_duration("furlongs").unwrap_err();
        assert!(matches!(err, ParseError::Invalid));
    }

    #[test]
    #[should_panic(expected = "out of range")]
    fn panics_on_overflow() {
        parse_duration(&"9".repeat(100)).unwrap();
    }

    #[test]
    fn returns_result() -> Result<(), Box<dyn std::error::Error>> {
        let parsed = parse_duration("1h")?;
        assert_eq!(parsed, 3_600_000);
        Ok(())
    }
}
```

Macros: `assert!`, `assert_eq!`, `assert_ne!`. For pattern matching, use `assert!(matches!(...))`. The `#[should_panic]` form is for asserting panics.

## Async Tests

`#[test]` runs sync — async tests need a runtime attribute:

```rust
// Tokio (most common)
#[tokio::test]
async fn fetches_user() {
    let user = fetch_user(1).await.unwrap();
    assert_eq!(user.id, 1);
}

// async-std
#[async_std::test]
async fn fetches_user() { /* ... */ }
```

Add the runtime to `[dev-dependencies]`: `tokio = { version = "1", features = ["macros", "rt"] }`.

## Mocking

Rust lacks runtime monkey-patching. Common approaches:

```rust
// 1. Trait-object dependency injection (most idiomatic)
trait UserRepo {
    fn find(&self, id: u64) -> Option<User>;
}

struct UserService<R: UserRepo> { repo: R }

impl<R: UserRepo> UserService<R> {
    fn get_name(&self, id: u64) -> Option<String> {
        self.repo.find(id).map(|u| u.name)
    }
}

// In tests:
struct StubRepo;
impl UserRepo for StubRepo {
    fn find(&self, _id: u64) -> Option<User> {
        Some(User { id: 1, name: "Alice".into() })
    }
}

#[test]
fn returns_name() {
    let svc = UserService { repo: StubRepo };
    assert_eq!(svc.get_name(1), Some("Alice".into()));
}
```

```rust
// 2. mockall crate — derive mock implementations
use mockall::automock;

#[automock]
trait UserRepo {
    fn find(&self, id: u64) -> Option<User>;
}

#[test]
fn returns_name_with_mock() {
    let mut mock = MockUserRepo::new();
    mock.expect_find().returning(|_| Some(User { id: 1, name: "Alice".into() }));
    let svc = UserService { repo: mock };
    assert_eq!(svc.get_name(1), Some("Alice".into()));
}
```

For HTTP, use `wiremock` or `mockito` to stand up a local server instead of mocking the client.

## Running

```bash
cargo test                              # All tests + doctests
cargo test --lib                        # Unit tests only
cargo test --test '*'                   # Integration tests only (--tests also runs lib/bin unit tests)
cargo test --doc                        # Doctests only
cargo test parser::tests::parses_hours  # Single test by path
cargo test -- --nocapture               # Show println! output
cargo test -- --test-threads=1          # Disable parallel (when tests share state)
```

## Coverage

```bash
# cargo-llvm-cov (recommended; uses LLVM's source-based coverage)
cargo install cargo-llvm-cov
cargo llvm-cov --html                   # HTML report in target/llvm-cov/html/
cargo llvm-cov --lcov --output-path lcov.info

# cargo-tarpaulin (ptrace engine: Linux x86_64; use --engine llvm elsewhere)
cargo install cargo-tarpaulin
cargo tarpaulin --out Html
```

## Common Gotchas

- **Tests run in parallel by default.** Shared state (env vars, files, network ports) needs `--test-threads=1` or per-test isolation.
- **`#[cfg(test)]` excludes from non-test builds.** A helper imported only in tests must also be `#[cfg(test)]` or it'll be flagged as unused in `cargo build`.
- **Integration tests can't access private items.** That's by design — integration tests use only the public API.
- **Doctests run too.** A code block in a doc comment that compiles AND runs (the default) — use `ignore` or `no_run` for examples that shouldn't execute.
- **`#[test]` on an `async fn` is a compile error** ("async functions cannot be used for tests"). Use `#[tokio::test]` or an equivalent runtime macro.

## Perf Tuning & Parallelism

The right flags drift across versions — run `cargo test --help` for the version-correct set, OR `resolve-library-id` + `query-docs` via context7 to fetch the current docs before tuning.

Stable knobs (recent majors):

| Flag / Tool | What |
|---|---|
| `cargo test -- --test-threads=N` | Defaults to num_cpus; lower for memory-bound or DB-sharing tests |
| `cargo test -- --nocapture` | Show `println!` output (default: hidden until failure) |
| `cargo test --release` | Compile in release mode — required for perf-sensitive integration tests |
| `cargo-nextest` (replacement runner) | 3–5× faster than `cargo test`; better failure summaries; per-test process isolation |
| `cargo nextest run --partition count:1/4` | Sharded execution for CI matrix |
| `cargo nextest run --retries N` | Retry a failed test N times. People who own CI set this policy. An agent never adds it to get a pass (see `test-types.md`, Flaky tests) |
| `cargo test --no-run` | Compile tests without running; separate compile-time from run-time in CI |
| `cargo test -- --skip <pat>` | Skip tests matching a substring pattern |

`cargo-nextest` is the recommended runner for medium+ workspaces. With workspace-shared `target/`, `sccache` or `rust-cache` pays for itself within 2 CI runs.

Per-machine guidance:
- **Laptop, local iteration:** `cargo nextest run --status-level fail --failure-output immediate` — only show failures; small workspaces fit in defaults.
- **CI runner with N vCPU:** `cargo nextest run --partition count:1/M -j N` across M runners; build once with `--no-run` then test for clean stage separation.
- **DB-sharing tests:** mark with `#[serial]` (`serial_test` crate) or drop `--test-threads=1` per test binary.
- **Memory-constrained:** `--test-threads=2` or even `1`; Rust unit tests can hold large fixture data per worker.

## Coverage Scope — What NOT to Test

```rust
// BAD — testing a pub-use re-export
// src/lib.rs
pub use crate::parser::parse_duration;
pub use crate::formatter::format_event;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn re_exports_exist() {
        let _ = parse_duration;        // compiles → "test passes"
        let _ = format_event;
    }
}
```

```bash
# GOOD — exclude generated + boilerplate from llvm-cov; test the real impls
cargo llvm-cov --html \
  --ignore-filename-regex '(generated/|migrations/|build\.rs$|src/bin/|/proto/|src/lib\.rs$)' \
  --fail-under-lines 80

# Common exclusions to add to your CI invocation:
#   - src/generated/*       (proto/grpc/sqlx codegen)
#   - src/migrations/*      (sqlx-cli, diesel, refinery)
#   - build.rs              (build script — test indirectly via crate behavior)
#   - src/lib.rs            (often just pub-use re-exports)
#   - src/bin/*.rs          (binary entry points — exercise via integration tests under tests/)
```

`#[cfg_attr(coverage_nightly, coverage(off))]` (nightly) per-fn suppression is a smell — prefer the config-level `--ignore-filename-regex` so reviewers see the rule.

## See Also

- `../SKILL.md` — universal 6-step procedure + constraints
- The Rust Book — Testing: https://doc.rust-lang.org/book/ch11-00-testing.html
- `mockall` docs: https://docs.rs/mockall/
- `cargo-llvm-cov`: https://github.com/taiki-e/cargo-llvm-cov
- `cargo-nextest`: https://nexte.st/
