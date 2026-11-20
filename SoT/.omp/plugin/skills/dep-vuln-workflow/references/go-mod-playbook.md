# Go Dependency Workflow — govulncheck / go list -u

Ecosystem-specific layer to the parent SKILL.md (`../SKILL.md`). Parent covers severity triage, exposure filter, the pre-flight checks, split strategy, and cadence — they apply unchanged. Load this file when the project ships Go.

## Audit & Upgrade Commands

```bash
# govulncheck (Go's official, reachability-aware scanner)
go install golang.org/x/vuln/cmd/govulncheck@latest
govulncheck ./...                            # Reachable vulns only
govulncheck -mode=binary ./bin/app           # Scan a compiled binary
govulncheck -test ./...                      # Include test deps

# go list (built-in)
go list -m -u all                            # All modules + available updates
go list -m -u -json all | jq                 # Machine-readable
go list -m -versions <module>                # List available versions

# go mod (built-in)
go mod tidy                                  # Reconcile go.mod + go.sum
go mod why <module>                          # Why is this dep here?
go mod graph                                 # Full dep graph
go get <module>@latest                       # Bump direct dep
go get <module>@vX.Y.Z                       # Pin
go get -u ./...                              # Upgrade all (patch+minor)

# osv-scanner (Google's cross-ecosystem, no reachability)
osv-scanner scan source -L go.mod            # v2 CLI; Go support reads go.mod; flags drift — verify with `osv-scanner scan --help`
```

Full check suite after every upgrade:

```bash
gofmt -l . && go vet ./... && staticcheck ./... && go test ./... && govulncheck ./...
```

## Go Major Upgrade Surprises

| Upgrade | Watch out for |
|---|---|
| Go 1.21 → 1.22 | For-range loop variables scoped per iteration (silent behavior change in goroutines) |
| Go 1.20 → 1.21 | `min`/`max`/`clear` builtins; `slices`/`maps` stdlib |
| Module path `/v2` and up | Major version bumps REQUIRE the path suffix (`example.com/lib/v2`) — `go get example.com/lib@v2.0.0` without the suffix fails with "module path must match major version" (or resolves `v2.0.0+incompatible` for a repo with no `go.mod`) |
| gRPC majors | Code-gen output differs across `protoc-gen-go-grpc` versions; mismatched server/client codegen breaks subtle things |
| `chi` / `gin` / `echo` majors | Middleware signature changes; trailing-slash routing semantics |
| `database/sql` driver bumps | `sql.Null*` generic in 1.22+; older drivers may need shims |

## Exposure Filter — Go Specifics

- **govulncheck is reachability-aware** — its key advantage over generic scanners. If the vulnerable function isn't in your call graph, govulncheck reports it as "found, not reachable." Patch on the next hygiene pass, not in emergency.
- **`// indirect` in `go.mod`** — transitive deps added to satisfy Minimum Version Selection (MVS). A direct-dep upgrade often clears them implicitly via `go mod tidy`.
- **Test-only deps** show up in `go.sum`. A vuln scoped to test code is not in the production binary.
- **`go.work` workspaces.** `govulncheck` follows the workspace; in CI, build the actual production binary and scan that with `-mode=binary` for the authoritative answer.

## Suppression Trap — BAD / GOOD

```go
// BAD — silence staticcheck to ship the upgrade faster
//nolint:staticcheck
result, _ := legacyAPI.Parse(payload)
```

```go
// GOOD — handle the error properly
result, err := legacyAPI.Parse(payload)
if err != nil {
    return fmt.Errorf("parse: %w", err)
}
```

`nolintlint` (golangci-lint's meta-linter) polices `//nolint:` directives. Set `require-explanation: true` to make the same-line reason `//nolint:errcheck // reason here` mandatory, and `require-specific: true` to ban bare `//nolint` without a linter name. Both default to **false**; opt in and keep both on. See `lint-no-suppressions`.

## Go Gotchas

- **Minimum Version Selection (MVS) surprises.** When two deps require different versions of a transitive, Go picks the HIGHER one. A passive upgrade in dep A might silently raise the version of unrelated dep B.
- **`//go:build ignore` / build tags.** Code excluded from your build won't be in the binary. govulncheck handles this; generic scanners may not.
- **`replace` directives in `go.mod`.** Fast-fix for an upstream vuln before a fixed release: `replace example.com/lib => example.com/lib v0.0.0-YYYYMMDDHHMMSS-<sha>`. Document why inline; remove once upstream releases.
- **Major version go-get pitfall.** `go get example.com/lib@v2.5.0` (without the `/v2` path suffix) fails with "invalid version: module contains a go.mod file, so module path must match major version". A repo with no `go.mod` resolves to `v2.5.0+incompatible` instead. Always include the suffix for v2+.
- **`go.sum` hash-pin discipline.** Every commit to `go.mod` or `go.sum` should be reviewable — never `go mod tidy` without inspecting the resulting `go.sum` diff.

## See Also

- `../SKILL.md` — universal playbook
- `lint-no-suppressions` skill — never silence staticcheck/vet errors surfaced by an upgrade
- govulncheck: https://go.dev/security/vuln/
- Go Vuln DB: https://pkg.go.dev/vuln/
- Module versioning rules: https://go.dev/ref/mod#major-version-suffixes
