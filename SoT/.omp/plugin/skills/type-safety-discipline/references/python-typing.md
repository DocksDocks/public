# Python — NewType + Tagged Unions + Pydantic

## Contents

- [NewType for ID safety](#newtype-for-id-safety)
  - [Validated newtype (NewType + factory)](#validated-newtype-newtype-factory)
- [Tagged unions with dataclasses + match](#tagged-unions-with-dataclasses-match)
- [Parse-don't-validate with Pydantic v2](#parse-dont-validate-with-pydantic-v2)
- [Literal types instead of string magic](#literal-types-instead-of-string-magic)
- [Avoid](#avoid)
- [References](#references)

Deep examples for the patterns referenced in the main `SKILL.md`. Read this when working in a Python codebase.

## NewType for ID safety

```python
from typing import NewType

UserId = NewType('UserId', str)
OrgId = NewType('OrgId', str)

def load_user(id: UserId) -> User:
    ...

org_id = OrgId('...')
load_user(org_id)  # ✗ mypy/pyright error
```

`NewType` is a static-only construct — runtime is plain `str`. Cast only at the boundary (DB query, parser).

### Validated newtype (NewType + factory)

```python
from typing import NewType

Email = NewType('Email', str)

def parse_email(raw: str) -> Email:
    if '@' not in raw:
        raise ValueError(f"Missing @: {raw!r}")
    return Email(raw)
```

Construct via `parse_email(...)` at the boundary; downstream the type proves validity.

## Tagged unions with dataclasses + match

```python
from dataclasses import dataclass
from typing import assert_never

@dataclass(frozen=True)
class UserInvite:
    user_id: UserId

@dataclass(frozen=True)
class GuestInvite:
    email: str
    name: str

Invite = UserInvite | GuestInvite

def send(invite: Invite) -> None:
    match invite:
        case UserInvite(user_id):
            send_to_user(user_id)
        case GuestInvite(email, name):
            send_to_guest(email, name)
        case _:
            assert_never(invite)
```

`assert_never` (Python 3.11+) forces `mypy --strict` to error if any variant is unhandled. Add a third dataclass to `Invite` → mypy flags `send()`.

For Python ≤ 3.10:

```python
from typing import NoReturn

def assert_never(x: NoReturn) -> NoReturn:
    raise AssertionError(f"Unhandled variant: {x!r}")
```

## Parse-don't-validate with Pydantic v2

```python
from pydantic import BaseModel

class Config(BaseModel):
    api_key: str
    port: int

config = Config.model_validate_json(raw)  # raises ValidationError on bad shape
```

For env vars, use `pydantic-settings`:

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    api_key: str
    port: int

    model_config = {"env_file": ".env"}

settings = Settings()  # raises on missing or wrong-typed vars
```

## Literal types instead of string magic

```python
from typing import Literal

Status = Literal["pending", "active", "cancelled"]

def set_status(s: Status) -> None: ...

set_status("activ")  # ✗ mypy error
```

For runtime enumeration, use `StrEnum` (3.11+):

```python
from enum import StrEnum

class Status(StrEnum):
    PENDING = "pending"
    ACTIVE = "active"
    CANCELLED = "cancelled"

set_status(Status.PENDING)
```

## Avoid

- **`Any`** — a hole in the type system. Use `object` (forces narrowing) or a typed union.
- **`cast(T, x)`** — a hint, not a check. Use `isinstance()` for narrowing.
- **`# type: ignore`** without a same-line reason — see the `lint-no-suppressions` skill.
- **String typing for IDs** — wrap with `NewType`.

## References

- Python typing — `NewType`: https://docs.python.org/3/library/typing.html#newtype
- Python typing — `assert_never`: https://docs.python.org/3/library/typing.html#typing.assert_never
- Pydantic v2 docs: https://docs.pydantic.dev/latest/
- PEP 634 — Structural Pattern Matching: https://peps.python.org/pep-0634/
