# SOLID — Go

## Contents

- [S — Single Responsibility](#s-single-responsibility)
- [O — Open/Closed (Strategy Map via map)](#o-openclosed-strategy-map-via-map)
- [L — Liskov Substitution (interface-as-sum-type + type switch)](#l-liskov-substitution-interface-as-sum-type-type-switch)
- [I — Interface Segregation (small interfaces are the Go idiom)](#i-interface-segregation-small-interfaces-are-the-go-idiom)
- [D — Dependency Inversion ("accept interfaces, return structs")](#d-dependency-inversion-accept-interfaces-return-structs)
- [See Also](#see-also)

Per-language expansion of the parent SKILL.md. Load when the project is Go. Pairs with the universal Decision Tree and `<constraint>` rules in `../SKILL.md`.

Go's small interfaces and lack of inheritance make Interface Segregation idiomatic by default. Design pressure concentrates on SRP (package boundaries), L (interfaces-as-sum-types), and D (interface accept, struct return).

## S — Single Responsibility

```go
// BAD — one package, four concerns
package users

type Service struct {
    db     *sql.DB
    mailer *Mailer
    audit  *AuditLog
}

func (s *Service) Create(input CreateUser) (*User, error) { /* ... */ }
func (s *Service) ListPermissions(id int64) ([]Permission, error) { /* ... */ }
func (s *Service) Invite(email string, role Role) error { /* ... */ }
func (s *Service) BeginViewAs(actor, target int64) error { /* ... */ }
```

```go
// GOOD — split by change axis into separate packages
// users/crud.go
package users
func Create(db *sql.DB, input CreateUser) (*User, error) { /* ... */ }
func Update(db *sql.DB, id int64, patch Patch) (*User, error) { /* ... */ }

// users/permissions/permissions.go
package permissions
func ListForUser(db *sql.DB, userID int64) ([]Permission, error) { /* ... */ }
func Grant(db *sql.DB, userID int64, perm Permission) error { /* ... */ }

// users/invitations/invitations.go
package invitations
func Invite(db *sql.DB, mailer Mailer, email string, role Role) error { /* ... */ }
```

Functions take only the dependencies they need; tests pass interfaces, not the whole service.

## O — Open/Closed (Strategy Map via map)

```go
// BAD — growing switch
func FormatEvent(kind string, e *Event) string {
    switch kind {
    case "user_invited":
        return fmt.Sprintf("%s invited %s", e.Actor, e.Target)
    case "role_changed":
        return fmt.Sprintf("%s changed role", e.Actor)
    case "permission_granted":
        return fmt.Sprintf("%s granted %s", e.Actor, e.Resource)
    default:
        return fmt.Sprintf("unknown: %s", kind)
    }
}
```

```go
// GOOD — strategy map via map[string]func
type Formatter func(*Event) string

var formatters = map[string]Formatter{
    "user_invited":       func(e *Event) string { return fmt.Sprintf("%s invited %s", e.Actor, e.Target) },
    "role_changed":       func(e *Event) string { return fmt.Sprintf("%s changed role", e.Actor) },
    "permission_granted": func(e *Event) string { return fmt.Sprintf("%s granted %s", e.Actor, e.Resource) },
}

func FormatEvent(kind string, e *Event) string {
    f, ok := formatters[kind]
    if !ok {
        return fmt.Sprintf("unknown: %s", kind)
    }
    return f(e)
}
```

For a closed set, prefer a sealed-interface pattern (next section). Go doesn't have exhaustive `switch` enforcement — `golangci-lint`'s `exhaustive` linter can be enabled to enforce it for `iota`-based enums.

## L — Liskov Substitution (interface-as-sum-type + type switch)

Go doesn't have algebraic data types, but a sealed interface gives you a discriminated union:

```go
// BAD — struct with optional fields, runtime checks
type Notification struct {
    Channel    string
    Recipient  string
    WebhookURL string
    Subject    string
}

func Send(n *Notification) error {
    if n.WebhookURL != "" {
        return postWebhook(n.WebhookURL, n)
    }
    if n.Channel == "email" {
        return sendEmail(n.Recipient, n.Subject)
    }
    if n.Channel == "sms" {
        return sendSms(n.Recipient, "")
    }
    return errors.New("unknown notification shape")
}
```

```go
// GOOD — sealed-interface sum type with type switch
type Notification interface {
    isNotification()
}

type Email struct {
    Recipient, Subject, Body string
}
func (Email) isNotification() {}

type Sms struct {
    Recipient, Body string
}
func (Sms) isNotification() {}

type Webhook struct {
    URL     string
    Payload map[string]any
}
func (Webhook) isNotification() {}

func Send(n Notification) error {
    switch n := n.(type) {
    case Email:   return sendEmail(n.Recipient, n.Subject, n.Body)
    case Sms:     return sendSms(n.Recipient, n.Body)
    case Webhook: return postWebhook(n.URL, n.Payload)
    default:
        return fmt.Errorf("unhandled variant: %T", n)
    }
}
```

The unexported `isNotification()` method seals the interface — only types in this package can implement it. Adding a new variant requires a code change in this file, surfacing the missing switch arm at review.

## I — Interface Segregation (small interfaces are the Go idiom)

```go
// BAD — one fat interface
type UserRepo interface {
    FindByID(id int64) (*User, error)
    FindByEmail(email string) (*User, error)
    Create(input CreateUser) (*User, error)
    Update(id int64, patch Patch) (*User, error)
    Delete(id int64) error
    ExportAll() ([]User, error)
    BulkAnonymize(ids []int64) error
}
```

```go
// GOOD — small interfaces defined at the caller, not at the producer
package handlers

// reader.go — handler that only reads
type UserReader interface {
    FindByID(id int64) (*User, error)
    FindByEmail(email string) (*User, error)
}

func GetUserHandler(repo UserReader, id int64) (*User, error) {
    return repo.FindByID(id)
}

// admin.go — handler that needs admin ops
type UserAdmin interface {
    ExportAll() ([]User, error)
    BulkAnonymize(ids []int64) error
}
```

Go convention: **define interfaces in the package that consumes them**, not in the package that produces the implementation. The concrete `*postgres.UserRepo` doesn't declare it implements `UserReader` — structural matching does it automatically.

## D — Dependency Inversion ("accept interfaces, return structs")

```go
// BAD — concrete SDK in business logic
import "github.com/stripe/stripe-go/v76"

type CheckoutService struct {
    client *stripe.Client
}

func (s *CheckoutService) Charge(amount int64) (string, error) {
    params := &stripe.ChargeParams{Amount: stripe.Int64(amount)}
    ch, err := s.client.Charges.New(params)
    if err != nil {
        return "", err
    }
    return ch.ID, nil
}
```

```go
// GOOD — interface as port, SDK adapter behind it
type PaymentGateway interface {
    Charge(amount int64) (string, error)
}

type CheckoutService struct {
    gateway PaymentGateway
}

func NewCheckoutService(gateway PaymentGateway) *CheckoutService {
    return &CheckoutService{gateway: gateway}
}

func (s *CheckoutService) Charge(amount int64) (string, error) {
    return s.gateway.Charge(amount)
}

// stripe_adapter.go
type StripeGateway struct {
    client *stripe.Client
}

func (s *StripeGateway) Charge(amount int64) (string, error) {
    params := &stripe.ChargeParams{Amount: stripe.Int64(amount)}
    ch, err := s.client.Charges.New(params)
    if err != nil { return "", err }
    return ch.ID, nil
}

// composition root: svc := NewCheckoutService(&StripeGateway{client: stripeClient})
// tests:            svc := NewCheckoutService(&FakeGateway{})
```

Function-argument form:

```go
type ChargeFn func(amount int64) (string, error)

func Checkout(amount int64, charge ChargeFn) (string, error) {
    return charge(amount)
}
// prod: Checkout(100, stripeGateway.Charge)
// test: Checkout(100, func(int64) (string, error) { return "test-charge", nil })
```

## See Also

- `../SKILL.md` — universal Decision Tree + constraints + Common Traps
- Effective Go — Interfaces: https://go.dev/doc/effective_go#interfaces
- "Accept interfaces, return structs" — https://bryanftan.medium.com/accept-interfaces-return-structs-in-go-d4cab29a301b
- `golangci-lint` `exhaustive` checker: https://golangci-lint.run/usage/linters/#exhaustive
