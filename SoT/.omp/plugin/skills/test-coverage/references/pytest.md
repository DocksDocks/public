# pytest Conventions

## Contents

- [Detection](#detection)
- [File Naming + Discovery](#file-naming-discovery)
- [Assertion Idioms](#assertion-idioms)
- [Fixtures](#fixtures)
- [Mocking](#mocking)
- [Async Tests](#async-tests)
- [Coverage](#coverage)
- [Common Gotchas](#common-gotchas)
- [Perf Tuning & Parallelism](#perf-tuning-parallelism)
- [Coverage Scope — What NOT to Test](#coverage-scope-what-not-to-test)
- [See Also](#see-also)

Per-framework expansion of the parent SKILL.md. Load when the project's test runner is pytest. Pairs with the universal 6-step procedure and `<constraint>` rules in `../SKILL.md`.

## Detection

| Signal | Confirms pytest |
|---|---|
| `[tool.pytest.ini_options]` in `pyproject.toml` | Yes |
| `pytest.ini` / `setup.cfg [tool:pytest]` | Yes |
| `conftest.py` files anywhere in repo | Yes (shared fixtures live here) |
| `tests/` directory next to source | Strong signal |
| Imports of `pytest` in `test_*.py` files | Confirmed |

## File Naming + Discovery

pytest discovers by glob: `test_*.py` and `*_test.py` (configurable via `python_files`). Test functions must start with `test_`. Test classes must start with `Test` and have no `__init__`.

Project structure conventions:

```
src/myapp/users.py
tests/test_users.py            # mirroring tree (most common)
tests/conftest.py              # shared fixtures
tests/integration/test_api.py  # split by tier (often)
```

`conftest.py` fixtures are visible to every test file in the same directory and below — no import needed.

## Assertion Idioms

pytest uses plain `assert` statements (rewritten for nice diffs):

```python
def test_parse_duration_returns_ms():
    assert parse_duration("1h30m") == 5_400_000

def test_parse_duration_raises_on_invalid():
    with pytest.raises(ValueError, match=r"invalid"):
        parse_duration("furlongs")

@pytest.mark.parametrize("inp,expected", [
    ("1h", 3_600_000),
    ("30m", 1_800_000),
    ("500ms", 500),
])
def test_parse_duration_table(inp, expected):
    assert parse_duration(inp) == expected
```

`pytest.approx` for floats; `pytest.raises` for exceptions; `pytest.warns` for warnings.

## Fixtures

```python
import pytest

@pytest.fixture
def db():                              # function-scoped (default)
    conn = create_test_db()
    yield conn
    conn.close()                       # teardown after yield

@pytest.fixture(scope="session")
def app_config():                      # session-scoped — once per test run
    return load_config("test.yaml")

@pytest.fixture
def user(db):                          # fixtures can depend on fixtures
    return db.insert("users", {"name": "Alice"})

def test_login(user, db):              # request fixtures as args
    assert db.find("users", user.id).name == "Alice"
```

Fixture scopes: `function` (default), `class`, `module`, `package`, `session`. Pick the narrowest that works — broader scopes leak state.

## Mocking

```python
# unittest.mock.patch (stdlib, most common)
from unittest.mock import patch, MagicMock

@patch("myapp.users.requests.get")
def test_fetch_user_calls_api(mock_get):
    mock_get.return_value.json.return_value = {"id": 1}
    result = fetch_user(1)
    mock_get.assert_called_with("https://api.example.com/users/1")
    assert result["id"] == 1

# pytest's monkeypatch (fixture, scoped to test)
def test_env_var(monkeypatch):
    monkeypatch.setenv("API_KEY", "test-key")
    assert read_api_key() == "test-key"

# pytest-mock (third-party, wraps unittest.mock)
def test_with_mocker(mocker):
    mock_get = mocker.patch("myapp.users.requests.get")
    mock_get.return_value.json.return_value = {"id": 1}
```

Patch *where the name is looked up*, not where it's defined: if `myapp/users.py` does `import requests`, patch `myapp.users.requests`, not `requests`.

## Async Tests

```python
# pytest-asyncio (most common)
import pytest

@pytest.mark.asyncio
async def test_async_fetch():
    result = await fetch_user_async(1)
    assert result.id == 1
```

Set `asyncio_mode = "auto"` in `pyproject.toml [tool.pytest.ini_options]` to auto-detect async tests without the marker.

## Coverage

```bash
# pytest-cov (most common)
pytest --cov=src --cov-report=term-missing --cov-report=html
pytest --cov=src --cov-fail-under=80      # fail CI under threshold

# Config in pyproject.toml
# [tool.coverage.run]
# source = ["src"]
# omit = ["src/myapp/migrations/*"]
# [tool.coverage.report]
# fail_under = 80
# show_missing = true
```

Use `# pragma: no cover` sparingly (and follow `lint-no-suppressions` discipline — never silence coverage just to make CI green).

## Common Gotchas

- **`async def` test that no async plugin handles → fails (pytest ≥ 8.4) or warns and skips (older pytest).** With pytest-asyncio in strict mode, add the `@pytest.mark.asyncio` marker or enable auto mode.
- **Patch target is import location, not definition.** Patching `requests.get` doesn't affect `from requests import get` in another module — patch `that_module.get`.
- **Fixture in same file overrides one in conftest.py.** Surprising precedence; rename if you want both available.
- **`scope="session"` fixtures with database state** leak across tests. Use transactions + rollback or `scope="function"` for DB.
- **Mutable default arg in fixture factory** — same trap as in any Python function; use a factory fixture instead.

## Perf Tuning & Parallelism

The right flags drift across versions — run `pytest --help` for the version-correct set, OR `resolve-library-id` + `query-docs` via context7 to fetch the current docs before tuning.

Stable knobs (recent majors):

| Flag / Plugin | What |
|---|---|
| `pytest -n auto` (pytest-xdist) | Parallelize across N workers; `auto` = num_cpus |
| `--dist=loadscope` (xdist) | Group by class/module; honors fixture scope better than default `load` |
| `--dist=worksteal` (xdist 3.x+) | Dynamic rebalancing; faster on uneven test durations |
| `pytest-forked` (separate plugin) | Each test in a forked subprocess — isolates crashes/leaks |
| `--lf` / `--last-failed` | Re-run only failures from last run |
| `--ff` / `--failed-first` | Run failures first, then everything else |
| `-x` / `--exitfirst` | Stop on first failure |
| `--durations=10` | Print 10 slowest tests — find perf hot spots |

Fixture-scope ↔ parallelism interaction: a `scope="session"` fixture with mutable state hits race conditions under `-n auto`. Either drop to `scope="function"` or use `pytest-xdist`'s `worker_id` fixture for per-worker setup.

Per-machine guidance:
- **Laptop, local iteration:** `pytest -x --lf -n auto` — exit on first fail, replay last failures, parallel.
- **CI runner with N vCPU:** `pytest -n auto --dist=worksteal --durations=20` — let xdist balance + surface slow tests.
- **DB-sharing tests:** isolate to a separate suite or use a per-worker DB fixture (`worker_id` namespaced DB names).
- **Flaky tests:** find the root cause (see `test-types.md`, Flaky tests). `pytest-rerunfailures` (`--reruns 2 --only-rerun TimeoutError`) is a CI policy that people decide. An agent never adds it to get a pass.

## Coverage Scope — What NOT to Test

```python
# BAD — testing a re-export module
# myapp/__init__.py
from myapp.users import create_user, find_user
from myapp.orders import create_order

# tests/test_init.py
from myapp import create_user, find_user, create_order
def test_exports():
    assert callable(create_user)
    assert callable(find_user)
    assert callable(create_order)
```

```toml
# GOOD — exclude in pyproject.toml; test the real modules
[tool.coverage.run]
source = ["src/myapp"]
omit = [
    "src/myapp/__init__.py",        # barrels (re-exports)
    "src/myapp/migrations/*",       # db migrations
    "src/myapp/types/*",            # type stubs / aliases
    "src/myapp/generated/*",        # codegen output (gRPC, GraphQL, etc.)
    "src/myapp/conf/*.py",          # config-only modules
    "*/site-packages/*",
]

[tool.coverage.report]
fail_under = 80
exclude_lines = [
    "pragma: no cover",
    "if TYPE_CHECKING:",
    "raise NotImplementedError",
    "if __name__ == .__main__.:",
    "@overload",
    "\\.\\.\\.",                    # Protocol body ellipses
]
```

Per-line `# pragma: no cover` is a smell — prefer the config-level `omit`/`exclude_lines` so the rule is visible to reviewers.

## See Also

- `../SKILL.md` — universal 6-step procedure + constraints
- pytest docs: https://docs.pytest.org/
- pytest-asyncio: https://pytest-asyncio.readthedocs.io/
- pytest-xdist: https://pytest-xdist.readthedocs.io/
- coverage.py: https://coverage.readthedocs.io/
