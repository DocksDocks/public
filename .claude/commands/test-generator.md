---
allowed-tools: Read, Grep, Glob, Write
description: Generate tests following project patterns and stack conventions
---

# Test Generation Task

Analyze the codebase and generate comprehensive tests matching existing patterns and conventions.

## Phase 0: Project Detection

First, identify the testing setup:
1. Check `package.json` for test frameworks (Jest, Vitest, etc.)
2. Check for test config files (jest.config.js, vitest.config.ts, etc.)
3. Check existing test files for patterns and conventions
4. Check for testing utilities (@testing-library, supertest, etc.)
5. Identify the package manager (pnpm, yarn, npm)

Document detected setup before generating tests.

---

## Phase 1: Analysis

1. Identify existing test patterns and conventions
2. Find untested or under-tested code
3. Analyze code paths and branches
4. Identify edge cases and boundary conditions
5. Note any custom test utilities/helpers

---

## Test Categories

### Unit Tests
- Test each function/method in isolation
- Cover all code paths and branches
- Test edge cases: null, undefined, empty, boundary values
- Test error conditions and exception handling
- Test async behavior and promises

### Integration Tests
- Test module interactions
- Test API endpoints end-to-end
- Test database operations
- Test external service integrations (with mocks)

---

## Stack-Specific Testing

### If TypeScript Detected
- Type-level tests where appropriate
- Test generic function type inference
- Mock typing verification
- Test type guards and narrowing

### If React/Next.js Detected

```typescript
// Component testing pattern
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

describe('ComponentName', () => {
  it('should render correctly', () => {
    render(<Component />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should handle user interaction', async () => {
    const user = userEvent.setup()
    render(<Component />)
    await user.click(screen.getByRole('button'))
    expect(screen.getByText('Updated')).toBeInTheDocument()
  })
})
```

- Test Server Components data fetching
- Test Client Components interactivity
- Test hooks with @testing-library/react-hooks
- Mock next/navigation, next/headers
- Test loading and error states

### If Fastify Detected

```typescript
// Fastify testing pattern
import { build } from './app'

describe('API Routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await build()
  })

  afterAll(async () => {
    await app.close()
  })

  it('should return data', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/resource'
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ data: expect.any(Array) })
  })
})
```

- Use fastify.inject() for testing
- Test validation schemas
- Test authentication/authorization
- Test error responses
- Test middleware/plugins

### If Zustand Detected

```typescript
// Zustand store testing pattern
import { useStore } from './store'

describe('Store', () => {
  beforeEach(() => {
    useStore.setState(initialState)
  })

  it('should update state', () => {
    const { action } = useStore.getState()
    action(payload)
    expect(useStore.getState().value).toBe(expected)
  })
})
```

- Reset store state between tests
- Test actions and selectors
- Test async actions
- Test middleware

### If Database/ORM Detected

```typescript
// Database testing pattern
import { db } from './db'
import { migrate } from './migrate'

describe('Repository', () => {
  beforeAll(async () => {
    await migrate()
  })

  beforeEach(async () => {
    await db.delete(table) // Clean slate
  })

  afterAll(async () => {
    await db.close()
  })

  it('should create and retrieve', async () => {
    const created = await repository.create(data)
    const found = await repository.findById(created.id)
    expect(found).toMatchObject(data)
  })
})
```

- Use test database/container
- Reset data between tests
- Test transactions
- Test constraints and validations

### If Drizzle ORM Detected

```typescript
// Drizzle testing pattern
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from './schema'

describe('Database Operations', () => {
  const client = postgres(process.env.TEST_DATABASE_URL!)
  const db = drizzle(client, { schema })

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' })
  })

  beforeEach(async () => {
    await db.delete(schema.users)
  })

  afterAll(async () => {
    await client.end()
  })

  it('should insert and query with relations', async () => {
    const [user] = await db.insert(schema.users)
      .values({ name: 'Test' })
      .returning()

    const result = await db.query.users.findFirst({
      where: eq(schema.users.id, user.id),
      with: { posts: true }
    })

    expect(result?.name).toBe('Test')
  })

  it('should handle transactions', async () => {
    await db.transaction(async (tx) => {
      await tx.insert(schema.users).values({ name: 'A' })
      await tx.insert(schema.users).values({ name: 'B' })
    })
  })
})
```

- Test schema relations with `with` queries
- Test `returning()` for inserts/updates
- Test transaction rollbacks
- Test prepared statements

---

## Edge Cases to Cover

- Empty inputs
- Null/undefined values
- Maximum/minimum values
- Invalid types
- Concurrent operations
- Timeout scenarios
- Network failures (mocked)
- Boundary conditions

---

## Test Quality Requirements

- Each test should test ONE thing
- Descriptive test names explaining the scenario
- Arrange-Act-Assert pattern
- Proper setup and teardown
- No test interdependencies
- Fast execution
- Deterministic results

---

## Output Format

For each test file generated:

1. Match existing project test conventions exactly
2. Use detected package manager in scripts (pnpm test, etc.)
3. Include setup/teardown as needed
4. Group related tests logically (describe blocks)
5. Include both positive and negative test cases
6. Add comments for complex test scenarios
7. Include type annotations if TypeScript

**File naming**: Follow project conventions
- `*.test.ts` or `*.spec.ts`
- Colocated or in `__tests__` directory
