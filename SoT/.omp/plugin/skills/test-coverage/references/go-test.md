# go test Conventions

## Contents

- [Detection](#detection)
- [File Naming + Layout](#file-naming-layout)
- [Assertion Idioms](#assertion-idioms)
- [Table-Driven Tests + Subtests](#table-driven-tests-subtests)
- [Helpers + Cleanup](#helpers-cleanup)
- [Mocking](#mocking)
- [Running](#running)
- [Coverage](#coverage)
- [Common Gotchas](#common-gotchas)
- [Perf Tuning & Parallelism](#perf-tuning-parallelism)
- [Coverage Scope — What NOT to Test](#coverage-scope-what-not-to-test)
- [See Also](#see-also)

Per-framework expansion of the parent SKILL.md. Load when the project's test runner is `go test`. Pairs with the universal 6-step procedure and `<constraint>` rules in `../SKILL.md`.

## Detection

| Signal | Confirms go test |
|---|---|
| `go.mod` present | Yes |
| `*_test.go` files alongside source | Yes |
| Imports of `testing` package | Confirmed |

## File Naming + Layout

Tests live in `*_test.go` files in the same package they test:

```
users/
├── users.go          # package users
├── users_test.go     # package users (white-box: access to unexported)
└── users_ext_test.go # package users_test (black-box: only public API)
```

`package users` in `_test.go` → white-box (can access lowercase identifiers).
`package users_test` in `_test.go` → black-box (treats the package as external).

## Assertion Idioms

Go's stdlib has no assertion library — use `t.Errorf` / `t.Fatalf`:

```go
package users

import "testing"

func TestParseDuration_HoursAndMinutes(t *testing.T) {
    got, err := ParseDuration("1h30m")
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    if want := 5_400_000; got != want {
        t.Errorf("got %d, want %d", got, want)
    }
}
```

`t.Errorf` records failure and continues; `t.Fatalf` records and stops. Use `Fatal` when subsequent assertions would be misleading (e.g., after `err != nil`).

`testify/assert` is widely used third-party:

```go
import "github.com/stretchr/testify/assert"

func TestParseDuration_Testify(t *testing.T) {
    got, err := ParseDuration("1h30m")
    assert.NoError(t, err)
    assert.Equal(t, 5_400_000, got)
}
```

`testify/require` is the fatal-on-failure variant.

## Table-Driven Tests + Subtests

The idiomatic Go pattern:

```go
func TestParseDuration(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        want    int64
        wantErr bool
    }{
        {"hour", "1h", 3_600_000, false},
        {"minutes", "30m", 1_800_000, false},
        {"compound", "1h30m", 5_400_000, false},
        {"invalid", "furlongs", 0, true},
    }
    for _, tc := range tests {
        t.Run(tc.name, func(t *testing.T) {
            got, err := ParseDuration(tc.input)
            if (err != nil) != tc.wantErr {
                t.Fatalf("err = %v, wantErr = %v", err, tc.wantErr)
            }
            if got != tc.want {
                t.Errorf("got = %d, want = %d", got, tc.want)
            }
        })
    }
}
```

`t.Run` creates a subtest visible in the output and individually runnable via `go test -run TestParseDuration/compound`.

## Helpers + Cleanup

```go
func setupDB(t *testing.T) *sql.DB {
    t.Helper()                          // omits this fn from failure stack
    db, err := sql.Open("sqlite", ":memory:")
    if err != nil { t.Fatal(err) }
    t.Cleanup(func() { db.Close() })    // runs after the test (even on failure)
    return db
}

func TestStoreUser(t *testing.T) {
    db := setupDB(t)
    // ... db is closed automatically via Cleanup
}
```

`t.Cleanup` replaces `defer` for test resources — runs after the test (including subtests) regardless of pass/fail.

## Mocking

Go has no runtime monkey-patching — use interfaces:

```go
type UserRepo interface {
    Find(id int64) (*User, error)
}

type UserService struct { repo UserRepo }

// In tests:
type stubRepo struct{}
func (stubRepo) Find(id int64) (*User, error) {
    return &User{ID: id, Name: "Alice"}, nil
}

func TestGetName(t *testing.T) {
    svc := UserService{repo: stubRepo{}}
    name, _ := svc.GetName(1)
    if name != "Alice" { t.Errorf("got %s", name) }
}
```

For HTTP, use `httptest`:

```go
import "net/http/httptest"

func TestFetchUser(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Write([]byte(`{"id":1,"name":"Alice"}`))
    }))
    defer srv.Close()

    client := &APIClient{BaseURL: srv.URL}
    user, _ := client.FetchUser(1)
    if user.Name != "Alice" { t.Errorf("got %s", user.Name) }
}
```

For complex mocks, use `go.uber.org/mock` (`mockgen`) or `gomock`.

## Running

```bash
go test ./...                           # All packages, recursive
go test ./users/...                     # Single package + subpackages
go test -run TestParseDuration          # Filter by name
go test -run TestParseDuration/compound # Subtest
go test -v                              # Verbose (per-test output)
go test -race                           # Race detector (CRITICAL for concurrent code)
go test -count=1                        # Disable cache (force re-run)
go test -timeout 30s                    # Per-package timeout
```

`-race` should be on in CI for any code that uses goroutines.

## Coverage

```bash
go test -cover ./...                              # Summary
go test -coverprofile=cov.out ./...               # Generate profile
go tool cover -html=cov.out                       # Open HTML report in browser
go tool cover -func=cov.out                       # Per-function summary
```

For coverage gates in CI, parse `go tool cover -func=cov.out | tail -1` and compare against a threshold.

## Common Gotchas

- **Same-name test function in different packages confuses `-run`.** Use package-qualified names: `go test -run '^TestFoo$' ./pkg/...`.
- **Loop-variable capture in subtests** before Go 1.22:
  ```go
  for _, tc := range tests {
      tc := tc                  // REQUIRED in Go <1.22 — capture by value
      t.Run(tc.name, ...)
  }
  ```
  Go 1.22+ fixes the loop-variable scope automatically.
- **`go test` caches passing tests** — change a file or use `-count=1` to force re-run.
- **`init()` runs once per test binary.** Each package has one test binary; shared state across packages still requires a fixture.
- **`*_test.go` files don't ship in releases** (excluded from `go build`).

## Perf Tuning & Parallelism

The right flags drift across versions — run `go help test` / `go help testflag` for the version-correct set, OR `resolve-library-id` + `query-docs` via context7 to fetch the current docs before tuning.

Stable knobs (recent majors):

| Flag | What |
|---|---|
| `go test -parallel N` | Cap parallel tests **within a package** (those calling `t.Parallel()`) |
| `go test -p N` | Parallel **package** compilation+execution; defaults to GOMAXPROCS |
| `go test -race` | Race detector — slow (~2-20× execution time, 5-10× memory) but catches concurrency bugs; CRITICAL in CI |
| `go test -count=1` | Bypass cache; required when measuring fresh runs |
| `go test -timeout 30s` | Kill stuck tests; default 10m too long for CI feedback |
| `go test -short` | Skip tests that opt into `testing.Short()` — fast feedback loops |
| `go test -failfast` | Stop on first failure within a package |
| `go test -shuffle=on` | Randomize test order — catches order-dependent bugs |
| `go test -cpu=1,2,4` | Run the full suite at each GOMAXPROCS — exposes concurrency bugs |

`t.Parallel()` opts a test into parallelism; tests that share state should NOT call it. Subtests inside `t.Run` each need their own `t.Parallel()` (and a loop-variable capture pre-Go 1.22 — see Gotchas above).

Per-machine guidance:
- **Laptop, local iteration:** `go test -short -failfast ./...` — skip integration, exit on first fail.
- **CI runner with N vCPU:** `go test -race -shuffle=on -timeout=60s -p=N ./...` — race+shuffle catches the bugs you'll otherwise debug in prod.
- **DB-sharing tests:** don't call `t.Parallel()`; or use per-worker schemas with `testing.M.Run` setup that namespaces by PID.
- **Memory-constrained:** lower `-p` to bound concurrent package binaries (each is a separate process with its own heap).

## Coverage Scope — What NOT to Test

```go
// BAD — testing a constants-only file
// pkg/api/errors.go
package api
var ErrNotFound = errors.New("not found")
var ErrForbidden = errors.New("forbidden")

// pkg/api/errors_test.go
func TestErrors(t *testing.T) {
    if ErrNotFound == nil { t.Error("nil") }
    if ErrForbidden == nil { t.Error("nil") }
}
```

```bash
# GOOD — scope coverage to packages with actual logic; filter generated/boilerplate
go test -cover -coverpkg=./internal/... -coverprofile=cov.out ./...

# Filter the profile after collection (post-processing is the Go idiom — there's no
# built-in exclude list):
grep -v -E '(/main\.go:|\.pb(\.gw)?\.go:|_mock\.go:|_generated\.go:|/mocks/|/generated/|wire_gen\.go:|_string\.go:)' cov.out > cov.filtered

# Common exclusions:
#   - *.pb.go / *.pb.gw.go        (protobuf / grpc-gateway codegen)
#   - **/mocks/*.go               (gomock generated)
#   - **/generated/*.go           (sqlc, ent, gqlgen output)
#   - main.go                     (entry point — exercise via integration tests)
#   - *_string.go                 (stringer-generated)
#   - **/wire_gen.go              (google/wire DI codegen)
```

File-level `//go:build` constraints are uncommon for coverage exclusion; prefer post-collection profile filtering or scoped `-coverpkg`. Codecov / Coveralls config files can also exclude paths post-upload.

## See Also

- `../SKILL.md` — universal 6-step procedure + constraints
- Go testing docs: https://pkg.go.dev/testing
- testify: https://github.com/stretchr/testify
- gomock (`go.uber.org/mock`): https://github.com/uber-go/mock
