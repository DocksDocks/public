# SOLID — Rust

## Contents

- [S — Single Responsibility](#s-single-responsibility)
- [O — Open/Closed (Strategy Map via HashMap or match)](#o-openclosed-strategy-map-via-hashmap-or-match)
- [L — Liskov Substitution (enums + pattern matching)](#l-liskov-substitution-enums-pattern-matching)
- [I — Interface Segregation (traits, narrow + composed)](#i-interface-segregation-traits-narrow-composed)
- [D — Dependency Inversion (trait objects or generics)](#d-dependency-inversion-trait-objects-or-generics)
- [See Also](#see-also)

Per-language expansion of the parent SKILL.md. Load when the project is Rust. Pairs with the universal Decision Tree and `<constraint>` rules in `../SKILL.md`.

Rust's type system makes Liskov and Interface Segregation almost-free; the design pressure shifts toward SRP (module organization) and DI (trait objects vs generics).

## S — Single Responsibility

```rust
// BAD — one struct, four concerns
pub struct UserService {
    db: Pool,
    mailer: Mailer,
    audit: AuditLog,
}

impl UserService {
    pub async fn create(&self, input: CreateUser) -> Result<User> { /* ... */ }
    pub async fn list_permissions(&self, id: u64) -> Result<Vec<Permission>> { /* ... */ }
    pub async fn invite(&self, email: &str, role: Role) -> Result<()> { /* ... */ }
    pub async fn begin_view_as(&self, actor: u64, target: u64) -> Result<()> { /* ... */ }
}
```

```rust
// GOOD — split into modules by change axis
// src/users/crud.rs
pub async fn create(db: &Pool, input: CreateUser) -> Result<User> { /* ... */ }
pub async fn update(db: &Pool, id: u64, patch: Patch) -> Result<User> { /* ... */ }

// src/users/permissions.rs
pub async fn list_for_user(db: &Pool, user_id: u64) -> Result<Vec<Permission>> { /* ... */ }
pub async fn grant(db: &Pool, user_id: u64, perm: Permission) -> Result<()> { /* ... */ }

// src/users/invitations.rs
pub async fn invite(db: &Pool, mailer: &Mailer, email: &str, role: Role) -> Result<()> { /* ... */ }
```

Each function takes only the dependencies it needs — tests no longer need to construct the full `UserService`.

## O — Open/Closed (Strategy Map via HashMap or match)

```rust
// BAD — growing match in formatter
pub fn format_event(kind: &str, e: &Event) -> String {
    match kind {
        "user_invited"       => format!("{} invited {}", e.actor, e.target),
        "role_changed"       => format!("{} changed role", e.actor),
        "permission_granted" => format!("{} granted {}", e.actor, e.resource),
        _ => format!("unknown: {}", kind),
    }
}
```

```rust
// GOOD — strategy map via HashMap<&str, fn>
use std::collections::HashMap;
use std::sync::LazyLock;   // std since Rust 1.80 — no once_cell dependency needed

type Formatter = fn(&Event) -> String;

static FORMATTERS: LazyLock<HashMap<&'static str, Formatter>> = LazyLock::new(|| {
    let mut m = HashMap::new();
    m.insert("user_invited",       (|e: &Event| format!("{} invited {}", e.actor, e.target)) as Formatter);
    m.insert("role_changed",       |e: &Event| format!("{} changed role", e.actor));
    m.insert("permission_granted", |e: &Event| format!("{} granted {}", e.actor, e.resource));
    m
});

pub fn format_event(kind: &str, e: &Event) -> String {
    FORMATTERS.get(kind).map(|f| f(e))
        .unwrap_or_else(|| format!("unknown: {}", kind))
}
```

For a closed set known at compile time, prefer an `enum`:

```rust
pub enum EventKind { UserInvited { target: String }, RoleChanged { role: Role }, PermissionGranted { resource: String } }

pub fn format_event(actor: &str, kind: &EventKind) -> String {
    match kind {
        EventKind::UserInvited { target }       => format!("{} invited {}", actor, target),
        EventKind::RoleChanged { role }         => format!("{} changed role to {:?}", actor, role),
        EventKind::PermissionGranted { resource } => format!("{} granted {}", actor, resource),
    }
}
// Exhaustiveness: missing variant → compile error
```

## L — Liskov Substitution (enums + pattern matching)

Rust enums ARE discriminated unions — the type system enforces Liskov by construction:

```rust
// BAD — Notification with optional fields, runtime checks
pub struct Notification {
    pub channel: Option<String>,
    pub recipient: Option<String>,
    pub webhook_url: Option<String>,
    pub subject: Option<String>,
}

pub fn send(n: &Notification) -> Result<()> {
    if let Some(url) = &n.webhook_url { return post_webhook(url, n); }
    if n.channel.as_deref() == Some("email") {
        return send_email(n.recipient.as_deref().unwrap(), n.subject.as_deref().unwrap_or(""));
    }
    Err(anyhow!("unknown notification shape"))
}
```

```rust
// GOOD — enum carries the variant; pattern match is exhaustive
pub enum Notification {
    Email   { recipient: String, subject: String, body: String },
    Sms     { recipient: String, body: String },
    Webhook { url: String, payload: serde_json::Value },
}

pub fn send(n: &Notification) -> Result<()> {
    match n {
        Notification::Email { recipient, subject, body } => send_email(recipient, subject, body),
        Notification::Sms { recipient, body }            => send_sms(recipient, body),
        Notification::Webhook { url, payload }           => post_webhook(url, payload),
    }
}
```

Add `#[non_exhaustive]` on enums shared across crates so adding a variant doesn't break downstream `match`es unintentionally.

## I — Interface Segregation (traits, narrow + composed)

```rust
// BAD — one fat trait
pub trait UserRepo {
    async fn find_by_id(&self, id: u64) -> Result<User>;
    async fn find_by_email(&self, email: &str) -> Result<Option<User>>;
    async fn create(&self, input: CreateUser) -> Result<User>;
    async fn update(&self, id: u64, patch: Patch) -> Result<User>;
    async fn delete(&self, id: u64) -> Result<()>;
    async fn export_all(&self) -> Result<Vec<User>>;
    async fn bulk_anonymize(&self, ids: &[u64]) -> Result<()>;
}
```

```rust
// GOOD — split by caller, compose at the boundary
pub trait UserReader {
    async fn find_by_id(&self, id: u64) -> Result<User>;
    async fn find_by_email(&self, email: &str) -> Result<Option<User>>;
}

pub trait UserWriter {
    async fn create(&self, input: CreateUser) -> Result<User>;
    async fn update(&self, id: u64, patch: Patch) -> Result<User>;
    async fn delete(&self, id: u64) -> Result<()>;
}

pub trait UserAdmin {
    async fn export_all(&self) -> Result<Vec<User>>;
    async fn bulk_anonymize(&self, ids: &[u64]) -> Result<()>;
}

// A single impl can satisfy all three; handlers depend on the narrow trait they actually use
async fn get_user_handler<R: UserReader>(repo: &R, id: u64) -> Result<User> {
    repo.find_by_id(id).await
}
```

## D — Dependency Inversion (trait objects or generics)

```rust
// BAD — concrete type pulled into business logic
use stripe::Client as StripeClient;

pub struct CheckoutService {
    stripe: StripeClient,
}

impl CheckoutService {
    pub async fn charge(&self, amount: i64) -> Result<ChargeId> {
        let r = self.stripe.charges_create(...).await?;
        Ok(ChargeId(r.id))
    }
}
```

```rust
// GOOD — trait as port, two impl-style choices

// Option A: generic (zero-cost, monomorphized)
pub trait PaymentGateway {
    async fn charge(&self, amount: i64) -> Result<ChargeId>;
}

pub struct CheckoutService<G: PaymentGateway> { gateway: G }

impl<G: PaymentGateway> CheckoutService<G> {
    pub async fn charge(&self, amount: i64) -> Result<ChargeId> {
        self.gateway.charge(amount).await
    }
}

// Option B: trait object (dynamic dispatch, simpler types).
// NOTE: a trait with native `async fn` is NOT dyn-compatible — Option B needs
// #[async_trait] on the trait (or a desugared `fn charge(&self) -> Pin<Box<dyn Future<Output = Result<ChargeId>> + Send + '_>>`).
pub struct CheckoutServiceDyn {
    gateway: Box<dyn PaymentGateway + Send + Sync>,
}
```

Generics are the Rust default — pay zero runtime cost. Use `dyn` only when you need heterogeneous collections or hot-swappable impls, and mind the async-fn dyn-compatibility note above.

## See Also

- `../SKILL.md` — universal Decision Tree + constraints + Common Traps
- `type-safety-discipline` references/rust-newtype.md — newtype pattern for ID types
- The Rust Book — Traits: https://doc.rust-lang.org/book/ch10-02-traits.html
- The Rust Book — Enums: https://doc.rust-lang.org/book/ch06-00-enums.html
