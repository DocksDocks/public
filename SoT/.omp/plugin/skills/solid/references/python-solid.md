# SOLID — Python

## Contents

- [S — Single Responsibility](#s-single-responsibility)
- [O — Open/Closed (Strategy Map via dict)](#o-openclosed-strategy-map-via-dict)
- [L — Liskov Substitution (tagged dataclasses, Protocol, match)](#l-liskov-substitution-tagged-dataclasses-protocol-match)
- [I — Interface Segregation (Protocol > ABC for narrow contracts)](#i-interface-segregation-protocol-abc-for-narrow-contracts)
- [D — Dependency Inversion (constructor or argument injection)](#d-dependency-inversion-constructor-or-argument-injection)
- [See Also](#see-also)

Per-language expansion of the parent SKILL.md. Load when the project is Python. Pairs with the universal Decision Tree and `<constraint>` rules in `../SKILL.md`.

Python's duck typing and `Protocol` (PEP 544) make Interface Segregation cheap; design pressure shifts to SRP (module organization) and DI (constructor injection vs argument passing).

## S — Single Responsibility

```python
# BAD — one class, four concerns
class UserService:
    def __init__(self, db, mailer, audit):
        self.db = db
        self.mailer = mailer
        self.audit = audit

    def create(self, input: CreateUser) -> User: ...
    def list_permissions(self, user_id: int) -> list[Permission]: ...
    def invite(self, email: str, role: Role) -> None: ...
    def begin_view_as(self, actor: int, target: int) -> None: ...
```

```python
# GOOD — module split by change axis
# users/crud.py
def create(db: Database, input: CreateUser) -> User: ...
def update(db: Database, id: int, patch: Patch) -> User: ...

# users/permissions.py
def list_for_user(db: Database, user_id: int) -> list[Permission]: ...
def grant(db: Database, user_id: int, perm: Permission) -> None: ...

# users/invitations.py
def invite(db: Database, mailer: Mailer, email: str, role: Role) -> None: ...
```

Each function declares only what it needs — tests inject just those collaborators, not the whole service.

## O — Open/Closed (Strategy Map via dict)

```python
# BAD — growing match-elif
def format_event(kind: str, e: Event) -> str:
    if kind == "user_invited":
        return f"{e.actor} invited {e.target}"
    elif kind == "role_changed":
        return f"{e.actor} changed role"
    elif kind == "permission_granted":
        return f"{e.actor} granted {e.resource}"
    else:
        return f"unknown: {kind}"
```

```python
# GOOD — dict of callables
from typing import Callable

Formatter = Callable[[Event], str]

FORMATTERS: dict[str, Formatter] = {
    "user_invited":       lambda e: f"{e.actor} invited {e.target}",
    "role_changed":       lambda e: f"{e.actor} changed role",
    "permission_granted": lambda e: f"{e.actor} granted {e.resource}",
}

def format_event(kind: str, e: Event) -> str:
    fmt = FORMATTERS.get(kind, lambda e: f"unknown: {kind}")
    return fmt(e)
```

For a closed set known at definition time + exhaustiveness via mypy, use a `match` statement:

```python
from dataclasses import dataclass
from typing import assert_never

@dataclass
class UserInvited:      kind: str = "user_invited";       actor: str = ""; target: str = ""
@dataclass
class RoleChanged:      kind: str = "role_changed";       actor: str = ""; role: str = ""
@dataclass
class PermissionGranted: kind: str = "permission_granted"; actor: str = ""; resource: str = ""

Event = UserInvited | RoleChanged | PermissionGranted

def format_event(e: Event) -> str:
    match e:
        case UserInvited(actor=a, target=t):       return f"{a} invited {t}"
        case RoleChanged(actor=a, role=r):         return f"{a} changed role to {r}"
        case PermissionGranted(actor=a, resource=r): return f"{a} granted {r}"
        case _:                                     assert_never(e)
```

`typing.assert_never` (Python 3.11+) is what makes mypy yell when a new variant is added but not handled.

## L — Liskov Substitution (tagged dataclasses, Protocol, match)

```python
# BAD — runtime isinstance + optional fields
@dataclass
class Notification:
    channel: str | None = None
    recipient: str | None = None
    webhook_url: str | None = None
    subject: str | None = None

def send(n: Notification) -> None:
    if n.webhook_url:
        return post_webhook(n.webhook_url, n)
    if n.channel == "email":
        return send_email(n.recipient, n.subject)
    if n.channel == "sms":
        return send_sms(n.recipient, n.subject or "")
    # silent no-op
```

```python
# GOOD — tagged union via dataclasses + match
from dataclasses import dataclass
from typing import Literal, assert_never

@dataclass
class Email:   kind: Literal["email"]   = "email";   recipient: str = ""; subject: str = ""; body: str = ""
@dataclass
class Sms:     kind: Literal["sms"]     = "sms";     recipient: str = ""; body: str = ""
@dataclass
class Webhook: kind: Literal["webhook"] = "webhook"; url: str = "";       payload: dict | None = None

Notification = Email | Sms | Webhook

def send(n: Notification) -> None:
    match n:
        case Email(recipient=r, subject=s, body=b): send_email(r, s, b)
        case Sms(recipient=r, body=b):              send_sms(r, b)
        case Webhook(url=u, payload=p):             post_webhook(u, p)
        case _:                                     assert_never(n)
```

## I — Interface Segregation (Protocol > ABC for narrow contracts)

```python
# BAD — one ABC, three concerns
from abc import ABC, abstractmethod

class UserRepo(ABC):
    @abstractmethod
    def find_by_id(self, id: int) -> User: ...
    @abstractmethod
    def find_by_email(self, email: str) -> User | None: ...
    @abstractmethod
    def create(self, input: CreateUser) -> User: ...
    @abstractmethod
    def update(self, id: int, patch: Patch) -> User: ...
    @abstractmethod
    def delete(self, id: int) -> None: ...
    @abstractmethod
    def export_all(self) -> list[User]: ...
    @abstractmethod
    def bulk_anonymize(self, ids: list[int]) -> None: ...
```

```python
# GOOD — Protocol-based, narrow + composable
from typing import Protocol

class UserReader(Protocol):
    def find_by_id(self, id: int) -> User: ...
    def find_by_email(self, email: str) -> User | None: ...

class UserWriter(Protocol):
    def create(self, input: CreateUser) -> User: ...
    def update(self, id: int, patch: Patch) -> User: ...
    def delete(self, id: int) -> None: ...

class UserAdmin(Protocol):
    def export_all(self) -> list[User]: ...
    def bulk_anonymize(self, ids: list[int]) -> None: ...

# A single concrete impl can satisfy all three (structural typing)
# Handlers depend on the narrow Protocol they actually use
def get_user_handler(repo: UserReader, id: int) -> User:
    return repo.find_by_id(id)
```

`Protocol` uses structural typing — no `inherits`-from required. Closer to Go interfaces than to Java's nominal ones.

## D — Dependency Inversion (constructor or argument injection)

```python
# BAD — business logic pulls in the concrete SDK
import stripe

class CheckoutService:
    def __init__(self):
        self.stripe = stripe.Client(api_key=os.environ["STRIPE_KEY"])

    def charge(self, amount: int) -> str:
        return self.stripe.charges.create(amount=amount).id
```

```python
# GOOD — Protocol as port, SDK adapter behind it
from typing import Protocol

class PaymentGateway(Protocol):
    def charge(self, amount: int) -> str: ...

class CheckoutService:
    def __init__(self, gateway: PaymentGateway):
        self.gateway = gateway

    def charge(self, amount: int) -> str:
        return self.gateway.charge(amount)

# Function-argument form (no class needed):
def checkout(amount: int, charge: Callable[[int], str]) -> str:
    return charge(amount)

# prod: checkout(100, lambda n: stripe_client.charges.create(amount=n).id)
# test: checkout(100, lambda n: "test-charge-1")
```

## See Also

- `../SKILL.md` — universal Decision Tree + constraints + Common Traps
- `type-safety-discipline` references/python-typing.md — NewType, tagged unions + assert_never, parse-don't-validate
- Python `Protocol` (PEP 544): https://peps.python.org/pep-0544/
- `typing.assert_never` (Python 3.11+): https://docs.python.org/3/library/typing.html#typing.assert_never
