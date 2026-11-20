# Phase 2c — Adversarial Hunt

Think like an attacker. Find what systematic scanning misses — especially chains where individually low-severity issues combine into a critical exposure.

<constraint>
Build chained-attack scenarios only from actual codebase issues, and write full step-by-step exploitation for the top 5 findings. Every finding has concrete code evidence — no theoretical-only issues. Zero chains is a valid result when the evidence supports no chain.
</constraint>

## Hunt categories

| Category | Look for |
|---|---|
| Auth bypass | routes skipping auth middleware (registration order, optional middleware); admin/debug paths (`/admin`, `/_internal`, `/__debug__`); method-based gaps (auth on GET not POST); header trust (`X-Internal-Auth`, `X-Forwarded-For`) |
| Hidden endpoints | `debug`/`test`/`dev`/`healthz`/`metrics`/`actuator`; admin panels; `swagger`/`api-docs`/`openapi`; backup/temp files (`.bak`, `.old`, `~`) |
| Chained attacks | info-disclosure + path traversal = file read; IDOR + PII = breach; open-redirect + missing OAuth `state` = ATO; mass-assignment + missing role re-check = privesc; prototype pollution + template = XSS/RCE |
| Timing | non-constant-time token compare (`===`); response-time user enumeration; cache-timing on auth'd vs anon |
| Cache poisoning | cache key from user headers (`X-Forwarded-Host`, `X-Original-URL`); shared cache serving cross-tenant data; `Vary` misconfig |
| Deserialization | `eval(`, schema-less `JSON.parse`, `pickle.loads`, Java `ObjectInputStream`, PHP `unserialize`; user-controlled class instantiation |
| SSRF | user-controlled URLs into fetch/request; webhook registration without allowlist; URL→PDF/image; cloud metadata (`169.254.169.254`, `metadata.google.internal`) |
| Mass assignment | ORM `create`/`update` from `req.body` without field whitelist; ability to set `isAdmin`/`role`/`balance`/`ownerId` from client |
| Prototype pollution | `_.merge`/`_.extend`/`Object.assign` / deep-copy on user input |
| Subdomain takeover | dangling cloud/DNS references in config |

## Output (write under `## Research` → `### Phase 2c: Adversarial Findings`)

**Additional findings** — per finding: `file:line` · Category · Evidence (quoted) · Severity · Suggested fix.

**Top 5 attack scenarios** — per scenario: title · Prerequisites · Step-by-step exploitation (numbered, with `file:line`) · Expected impact · Detection difficulty · Chain components (if chained).

End with: total additional findings, and chained-attack count (zero is valid when the evidence supports no chain).

## Gotcha

| Gotcha | Fix |
|---|---|
| Listing categories with no codebase evidence | Only report a category if you found a concrete instance; "examined, none found" is a valid note |
