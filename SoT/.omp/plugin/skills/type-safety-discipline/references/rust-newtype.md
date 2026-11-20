# Rust — Newtype Pattern + Type-Safety Idioms

## Contents

- [Newtype for ID safety](#newtype-for-id-safety)
  - [Validated newtype](#validated-newtype)
  - [`From` / `TryFrom` for conversion](#from-tryfrom-for-conversion)
- [Discriminated unions (enums)](#discriminated-unions-enums)
  - [Pattern matching with guards](#pattern-matching-with-guards)
- [Parse-don't-validate with serde](#parse-dont-validate-with-serde)
- [Avoid](#avoid)
- [References](#references)

Deep examples for the patterns referenced in the main `SKILL.md`. Read this when working in a Rust codebase.

## Newtype for ID safety

```rust
pub struct UserId(String);
pub struct OrgId(String);

impl UserId {
    pub fn new(s: impl Into<String>) -> Self {
        Self(s.into())
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

fn load_user(id: UserId) -> Result<User, Error> {
    // ...
}

// Compile error — OrgId is not UserId
load_user(OrgId::new("..."));
```

Newtypes are zero-cost — the wrapper exists only at the type level. Add `#[derive(Clone, Debug, Hash, Eq, PartialEq)]` for the common bag of traits.

### Validated newtype

When the wrapped value must satisfy a constraint, hide the constructor:

```rust
pub struct Email(String);

impl Email {
    pub fn parse(s: &str) -> Result<Self, ParseError> {
        if !s.contains('@') { return Err(ParseError::MissingAt); }
        Ok(Self(s.to_owned()))
    }
}
```

Construct via `Email::parse(raw)` at the boundary; everywhere downstream the `Email` type proves validity.

### `From` / `TryFrom` for conversion

```rust
impl TryFrom<String> for Email {
    type Error = ParseError;
    fn try_from(s: String) -> Result<Self, Self::Error> {
        Self::parse(&s)
    }
}

let email: Email = raw_string.try_into()?;
```

`From`/`Into` for infallible conversions; `TryFrom`/`TryInto` when the conversion can fail.

## Discriminated unions (enums)

```rust
pub enum Invite {
    User { id: UserId },
    Guest { email: String, name: String },
}

pub fn send(invite: Invite) {
    match invite {
        Invite::User { id } => send_to_user(id),
        Invite::Guest { email, name } => send_to_guest(email, name),
    }
}
```

`match` is exhaustive by default — add `Invite::Suspended` and the `match` arm fails to compile until handled.

### Pattern matching with guards

```rust
match event {
    Event::Click { x, y } if x < 0 => ignore(),
    Event::Click { x, y } => on_click(x, y),
    Event::Key { code } => on_key(code),
    Event::Scroll { delta } => on_scroll(delta),
}
```

## Parse-don't-validate with serde

```rust
use serde::Deserialize;

#[derive(Deserialize)]
pub struct Config {
    pub api_key: String,
    pub port: u16,
}

let raw = std::fs::read_to_string("config.json")?;
let config: Config = serde_json::from_str(&raw)?;  // Result; ? propagates parse errors
```

The struct definition IS the schema. `serde_json::from_str` returns `Result<Config, Error>` — no `as` casts.

For env vars, use `envy`:

```rust
#[derive(Deserialize)]
struct Env {
    api_key: String,
    port: u16,
}

let env: Env = envy::from_env()?;
```

## Avoid

- **`unsafe` casts and `mem::transmute`** — bypass the type system; reserve for FFI or known-safe layout-compatible types.
- **`Box<dyn Any>`** as a poor-man's `any`. Use traits or enums for polymorphism.
- **String typing for IDs** — `fn load_user(id: String)` permits `load_user(org_id_string)`. Always wrap.

## References

- Rust Book — newtype pattern: https://doc.rust-lang.org/book/ch20-03-advanced-types.html
- `serde` documentation: https://serde.rs/
- `envy` crate: https://docs.rs/envy/
