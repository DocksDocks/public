# SOLID — TypeScript / JavaScript

## Contents

- [S — Single Responsibility](#s-single-responsibility)
- [O — Open/Closed (Strategy Map)](#o-openclosed-strategy-map)
- [L — Liskov Substitution](#l-liskov-substitution)
- [I — Interface Segregation](#i-interface-segregation)
- [D — Dependency Inversion](#d-dependency-inversion)
- [See Also](#see-also)

Per-language expansion of the parent SKILL.md. Load when the project is TS / JS / Node / browser-based. Pairs with the universal Decision Tree and `<constraint>` rules in `../SKILL.md`.

## S — Single Responsibility

```ts
// BAD — userService.ts covers CRUD + permissions + invites + view-as
export class UserService {
  async createUser(input: CreateUser) { /* ... */ }
  async updateUser(id: string, patch: Patch) { /* ... */ }
  async listPermissions(userId: string) { /* ... */ }
  async grantPermission(userId: string, perm: Permission) { /* ... */ }
  async inviteUser(email: string, role: Role) { /* ... */ }
  async revokeInvite(token: string) { /* ... */ }
  async beginViewAs(actorId: string, targetId: string) { /* ... */ }
}
```

```ts
// GOOD — split by change axis, one file per concern
// src/users/crud.ts
export async function createUser(input: CreateUser) { /* ... */ }
export async function updateUser(id: string, patch: Patch) { /* ... */ }
// src/users/permissions.ts
export async function listPermissions(userId: string) { /* ... */ }
export async function grantPermission(userId: string, perm: Permission) { /* ... */ }
// src/users/invitations.ts
export async function inviteUser(email: string, role: Role) { /* ... */ }
export async function revokeInvite(token: string) { /* ... */ }
// src/users/view-as.ts
export async function beginViewAs(actorId: string, targetId: string) { /* ... */ }
```

Tests now mock only the dependencies of the function under test — not the whole UserService.

## O — Open/Closed (Strategy Map)

See parent SKILL.md for the canonical example. TS-specific extensions:

```ts
// Correlated union (TypeScript 4.6+): one payload map drives the union and the dispatch table
type PayloadMap = {
  user_invited:       { actor: string; target: string };
  role_changed:       { actor: string; role: Role };
  permission_granted: { actor: string; resource: string };
};
type EventPayload<K extends keyof PayloadMap = keyof PayloadMap> =
  { [P in K]: { kind: P } & PayloadMap[P] }[K];

const FORMATTERS: { [K in keyof PayloadMap]: (e: EventPayload<K>) => string } = {
  user_invited:       (e) => `${e.actor} invited ${e.target}`,
  role_changed:       (e) => `${e.actor} changed role to ${e.role}`,
  permission_granted: (e) => `${e.actor} granted ${e.resource}`,
};

function formatEvent<K extends keyof PayloadMap>(e: EventPayload<K>): string {
  return FORMATTERS[e.kind](e); // no cast: the generic K keeps kind and payload correlated
}
```

The mapped-type signature means adding a new key to `PayloadMap` causes a compile error if the corresponding `FORMATTERS` entry is missing. **No `default:` swallow and no `as` cast — the type system enforces exhaustiveness and checks the argument.** Pattern source: https://github.com/microsoft/TypeScript/pull/47109. If the correlated-union types are too heavy for the team, use an exhaustive `switch` (see L below) instead of a cast.

## L — Liskov Substitution

```ts
// BAD — runtime instanceof / duck-typing, ambiguous fallthrough
type Notification = {
  channel?: string;
  recipient?: string;
  webhookUrl?: string;
};

function send(n: Notification) {
  if (n.webhookUrl) return postWebhook(n.webhookUrl, n);
  if (n.channel === "email") return sendEmail(n.recipient!, n);
  if (n.channel === "sms")   return sendSms(n.recipient!, n);
  // silent no-op for unknown shapes
}
```

```ts
// GOOD — discriminated union, exhaustive narrowing
type Email   = { kind: "email";   recipient: string; subject: string; body: string };
type Sms     = { kind: "sms";     recipient: string; body: string };
type Webhook = { kind: "webhook"; url: string; payload: object };
type Notification = Email | Sms | Webhook;

function send(n: Notification) {
  switch (n.kind) {
    case "email":   return sendEmail(n.recipient, n.subject, n.body);
    case "sms":     return sendSms(n.recipient, n.body);
    case "webhook": return postWebhook(n.url, n.payload);
  }
}
```

Add an exhaustiveness sentinel for stronger drift protection:

```ts
function send(n: Notification): string {
  switch (n.kind) {
    case "email":   return sendEmail(...);
    case "sms":     return sendSms(...);
    case "webhook": return postWebhook(...);
    default:        { const _exhaustive: never = n; throw new Error(); }
  }
}
```

## I — Interface Segregation

```ts
// BAD — one Repository, three concerns
interface UserRepository {
  findById(id: string): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
  create(input: CreateUser): Promise<User>;
  update(id: string, patch: Patch): Promise<User>;
  delete(id: string): Promise<void>;
  exportAll(): Promise<User[]>;
  bulkAnonymize(ids: string[]): Promise<void>;
  resetSchema(): Promise<void>;
}
```

```ts
// GOOD — split along the caller boundary
interface UserReader {
  findById(id: string): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
}
interface UserWriter {
  create(input: CreateUser): Promise<User>;
  update(id: string, patch: Patch): Promise<User>;
  delete(id: string): Promise<void>;
}
interface UserAdmin {
  exportAll(): Promise<User[]>;
  bulkAnonymize(ids: string[]): Promise<void>;
  resetSchema(): Promise<void>;
}
// One impl can satisfy all three; callers depend on the narrow interface
```

## D — Dependency Inversion

```ts
// BAD — business logic instantiates the concrete SDK
import Stripe from "stripe";
export class CheckoutService {
  private stripe = new Stripe(process.env.STRIPE_KEY!);
  async charge(amount: number) {
    return this.stripe.charges.create({ amount });
  }
}
```

```ts
// GOOD — interface as port, SDK adapter behind it; a factory closure, not a class
interface PaymentGateway {
  charge(amount: number): Promise<{ id: string }>;
}
export function createCheckout(gateway: PaymentGateway) {
  return {
    charge: (amount: number) => gateway.charge(amount),
  };
}
// composition root wires the Stripe adapter; tests pass a fake gateway
```

Use a `class` with constructor injection only when a DI-container framework requires the shape (class gate case (c) in `type-safety-discipline` §9).

Function-argument form (no DI container needed):

```ts
export async function checkout(
  amount: number,
  charge: (n: number) => Promise<{ id: string }>,
) {
  return charge(amount);
}
// prod: checkout(100, (n) => stripe.charges.create({ amount: n }))
// test: checkout(100, async () => ({ id: "test-charge-1" }))
```

## See Also

- `../SKILL.md` — universal Decision Tree + constraints + Common Traps
- `type-safety-discipline` skill — discriminated unions, exhaustiveness checking, parse-don't-validate
- TS discriminated unions: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions
