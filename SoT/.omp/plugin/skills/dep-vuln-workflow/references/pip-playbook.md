# Python Dependency Workflow — pip-audit / poetry / pipenv / uv

Ecosystem-specific layer to the parent SKILL.md (`../SKILL.md`). Parent covers severity triage, exposure filter, the pre-flight checks, split strategy, and cadence — they apply unchanged. Load this file when the project ships Python.

## Audit & Upgrade Commands

```bash
# pip-audit (PyPA's official scanner, free)
pip install pip-audit
pip-audit                                   # Scan current env
pip-audit -r requirements.txt               # Scan a requirements file
pip-audit --fix                             # Apply non-breaking fixes
pip-audit --strict                          # Fail if any dependency cannot be collected (CI use)
pip-audit -f json                           # Machine-readable

# poetry
poetry show --outdated
poetry show --tree                          # Trace transitive
poetry update <pkg>                         # Patch+minor within constraints
poetry add <pkg>@^X                         # Lift constraint to upgrade major

# pipenv
pipenv scan                                 # Audit (delegates to safety; the old `check` subcommand is unsupported since 2025-06)
pipenv graph                                # Transitive trace
pipenv update <pkg>

# uv (Astral's fast resolver, lockfile-aware)
uv pip compile requirements.in -o requirements.txt --upgrade
uv audit                                    # Audit the locked project (preview feature; `--no-group` / `--no-extra` narrow scope)
uv export --format requirements-txt | pip-audit -r /dev/stdin   # Fallback for uv releases without `uv audit`
uv tree

# safety (third-party scanner, broader DB)
pip install safety                          # Safety 3 requires an account: `safety auth login` (or an API key)
safety scan                                 # Safety 3 command (`check` is deprecated in Safety 3; use `scan`)
```

Full check suite after every upgrade:

```bash
ruff check . && mypy . && pytest && pip-audit --strict
```

## Python Major Upgrade Surprises

| Upgrade | Watch out for |
|---|---|
| Python 3.11 → 3.12 | `distutils` removed; PEP 695 generic syntax; PEP 698 `@typing.override` |
| Python 3.12 → 3.13 | Free-threaded build (no-GIL) opt-in; legacy `unittest` alias deprecations |
| Django 4 → 5 | Async views/forms expanded; `django.utils.timezone.utc` removed; `USE_DEPRECATED_PYTZ` gone |
| FastAPI ↔ Pydantic version coupling | FastAPI ≥ 0.126 requires Pydantic ≥ 2.7 (0.100–0.125 accept v1 or v2; 0.128 drops `pydantic.v1`); v1 → v2 is a major rewrite of validators/config |
| Pydantic v1 → v2 | `@validator` → `@field_validator`; `Config` class → `model_config`; `.dict()` → `.model_dump()` |
| SQLAlchemy 1.4 → 2.0 | `Session.execute()` returns `Result`; `Query` API is legacy (still works); prefer `select()` + `Session.execute()` |
| Flask 2 → 3 | `before_first_request` removed; `app.json_encoder` removed; signed-serializer changes |

## Exposure Filter — Python Specifics

- **`extras_require` / `[project.optional-dependencies]`** — extras only install when requested (`pip install foo[bar]`). A vuln in an unused extra is not in your runtime.
- **Dev groups** (`[tool.poetry.group.dev]`, `requirements-dev.txt`) — never on a production server. `poetry install --only main` for prod images confirms.
- **`pip-audit -r requirements.txt` for the prod-only file** narrows scope to runtime.
- **CLI vs library use** — `pyinstaller` and similar are build-time only. A vuln scoped to packaging tools isn't in the runtime.

## Suppression Trap — BAD / GOOD

```python
# BAD — silence the mypy error to ship the upgrade faster
result = legacy_lib.parse(payload)  # type: ignore
```

```python
# GOOD — fix the type (or add the bracketed code if the suppression is truly justified)
result: dict[str, Any] = legacy_lib.parse(payload)
```

If a suppression is genuinely justified, always use the bracketed form: `# type: ignore[no-untyped-call]`. See `lint-no-suppressions`.

## Python Gotchas

- **Pinning vs ranges in `requirements.txt`.** Fully pinned (`==X.Y.Z`) blocks `pip-audit --fix`; ranged (`>=X.Y,<X+1`) lets you patch within. Use `pip-compile` so the lockfile is fully pinned but the input is ranged.
- **`safety` vs `pip-audit`.** Safety has a broader DB (commercial tier); pip-audit is PyPA-official and free. Run both if security posture matters.
- **Wheel hash pinning** (`--hash=sha256:...`) is most secure but breaks `pip-audit --fix`. Reserved for high-assurance environments.
- **Pydantic v1/v2 coexistence.** Bridge packages let monorepos migrate piecemeal. Audit BOTH versions; v1 vulns still apply to anything still pinned to v1.
- **`pip-audit` exit codes.** Exit `1` when it finds a known vulnerability, `0` when it finds none — usable directly in CI. You cannot suppress this exit code; use `--ignore-vuln ID` for an accepted finding. `--strict` does not change this rule: it also fails the audit when dependency collection fails for any package.
- **`uv.lock` vs `poetry.lock`** — different formats, equally authoritative. Commit whichever your tool produces; never both.

## See Also

- `../SKILL.md` — universal playbook
- `lint-no-suppressions` skill — never silence type-checker errors surfaced by an upgrade
- pip-audit: https://github.com/pypa/pip-audit
- PyPA Advisory DB: https://github.com/pypa/advisory-database
- OSV Python: https://osv.dev/list?ecosystem=PyPI
