# Phase 1 — Security Discovery (attack-surface map)

Map what exists; do not diagnose. This output is the starting map for every later phase.

<constraint>
Enumerate, don't judge. Record facts ("file X uses pattern Y at line Z"), never verdicts ("this is vulnerable"). Diagnosis belongs to Phases 2–3. If something looks concerning, list it as a located fact and move on.
</constraint>

## Project profile

Stack (languages, frameworks), package manager, test runner, linter, and scope (a path, or the whole project). Check `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, `pyproject.toml`.

## Security-critical areas (locate + cite `file:line`)

Search for each keyword cluster, then read context to confirm the area's purpose:

| Area | Keywords |
|---|---|
| Auth / login | `login`, `signin`, `auth`, `passport`, `jwt`, `session`, `token` |
| Authz / permissions | `authorize`, `permission`, `role`, `middleware`, `guard`, `policy`, `acl` |
| API endpoints / routes | Express / FastAPI / Django URLs / Rails route definitions |
| DB / ORM | `query`, `execute`, `raw`, `findAll`, `select`/`insert`/`update`/`delete` |
| File I/O | `multer`, `busboy`, `upload`, `sendFile`, `download`, `stream` |
| User input | `req.body`, `request.POST`/`GET`, `params`, `query`, `argv` |
| Sessions | `session`, `cookie`, `store`, `passport.session` |
| Crypto | `crypto`, `bcrypt`, `argon2`, `hash`, `encrypt`/`decrypt`, `sign`/`verify` |
| External calls | `axios`, `fetch`, `requests`, `http.client` |
| Config / secrets | `config`, `.env`, `secrets`, `credentials` |
| Env usage | `process.env`, `os.environ`, `ENV[`, `System.getenv` |

## Entry points (every way data enters)

HTTP routes (GET/POST/PUT/PATCH/DELETE → handler), WebSocket handlers, CLI args (`commander`/`argparse`), file imports/parsers, message-queue consumers (`kafka`/`rabbitmq`/`sqs`/`pubsub`), cron / scheduled tasks.

## Trust boundaries

- **Client/server**: which inputs come from untrusted clients; which layer validates.
- **Inter-service**: which services trust each other without re-authentication.
- **Third-party data**: where external data enters and how (or whether) it is validated.

## Output (write under `## Research` → `### Phase 1: Discovery Results`)

`Project Profile` · `File Map` (source dirs + counts) · `Security-Critical Areas` (by category, each with `file:line`) · `Entry Points` · `Trust Boundaries`.

## Gotcha

| Gotcha | Fix |
|---|---|
| Mapping only the scoped path and missing global auth code | Auth/authz enumeration always covers the full project, even when scope is narrow |
