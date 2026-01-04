---
allowed-tools: Read, Grep, Glob, Edit, Write, Task, Bash(git:*), Bash(ls:*), Bash(find:*)
description: Generate API documentation based on detected framework
---

# API Documentation Generator

Analyze the codebase and generate comprehensive API documentation matching the project's framework.

## Phase 0: Exploration

Use the **Task tool with `subagent_type=Explore`** to understand the codebase before generating docs.

1. **Launch explore agent** to:
   - Find all API routes and endpoints
   - Map request/response schemas
   - Identify authentication patterns
   - Discover existing documentation

## Phase 1: Planning

Before generating documentation, create a plan:

1. **Document scope**: List all endpoints to document
2. **Format decision**: OpenAPI, Markdown, or both
3. **Structure outline**: How docs will be organized
4. **Present plan to user** for approval

## Phase 2: Verification (Multi-Agent)

**Launch multiple agents in parallel** to ensure complete coverage:

```
Use Task tool to launch these agents simultaneously:
```

1. **Agent 1 - Route Discovery**: Find all API endpoints
2. **Agent 2 - Schema Analysis**: Extract request/response types
3. **Agent 3 - Auth/Middleware Check**: Map security requirements

**Cross-check results:**
- All agents must find the same endpoints
- Schemas must be consistent
- No endpoints should be missed

---

## Phase 3: Project Detection

Identify the API framework and tools:
1. Check `package.json` for framework (Fastify, Express, Next.js, Hono, etc.)
2. Check `tsconfig.json` for path aliases (use in import examples)
3. Check for existing OpenAPI/Swagger setup
4. Check for validation libraries (Zod, Joi, TypeBox, etc.)
5. Check for authentication patterns
6. Identify the package manager for script commands

Document detected setup before generating. Use project's path aliases in examples.

---

## Phase 4: Discovery

1. Find all API endpoints/routes
2. Identify request/response schemas
3. Extract authentication requirements
4. Find middleware and validation rules
5. Locate existing documentation

---

## Phase 5: Stack-Specific Documentation

### If Fastify Detected

```typescript
// Route documentation format
/**
 * @route GET /api/users
 * @description List all users with pagination
 * @tags Users
 * @security bearerAuth
 */
fastify.get('/users', {
  schema: {
    querystring: PaginationSchema,
    response: {
      200: UsersResponseSchema
    }
  }
}, handler)
```

- Document route schemas (TypeBox, Zod)
- Include Fastify Swagger annotations
- Document plugin configurations
- Note lifecycle hooks affecting routes

### If Database/ORM Detected
First, identify the ORM and document accordingly:

- Document database schema and relations
- Include entity relationship diagram (Mermaid)
- Document type exports for API contracts

```typescript
// Use ORM types for API documentation

// Drizzle
type User = typeof users.$inferSelect

// Prisma
import { User } from '@prisma/client'

// TypeORM
import { User } from './entities/User'
```

### If Next.js API Routes Detected

```typescript
// App Router - route.ts documentation format
/**
 * @route GET /api/users/[id]
 * @description Get user by ID
 * @param id - User ID
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  // Implementation
}
```

- Document App Router handlers (GET, POST, etc.)
- Document Server Actions
- Note middleware effects
- Document revalidation strategies

### If Express Detected

```typescript
// Express route documentation
/**
 * @route POST /api/users
 * @description Create a new user
 * @body {CreateUserDto}
 * @returns {User}
 */
router.post('/users', validateBody(schema), createUser)
```

- Document middleware chain
- Include validation schemas
- Note error handling middleware

### If GraphQL Detected

- Generate schema documentation
- Document resolvers
- Include query/mutation examples
- Document subscriptions if present

---

## Documentation Structure

### For Each Endpoint

```markdown
## [METHOD] /path/to/endpoint

**Description**: What this endpoint does

**Authentication**: Required/Optional (Bearer, API Key, etc.)

**Request**
- Headers:
  ```
  Authorization: Bearer <token>
  Content-Type: application/json
  ```
- Path Parameters: `/users/:id`
- Query Parameters:
  | Name | Type | Required | Description |
  |------|------|----------|-------------|
  | page | number | No | Page number (default: 1) |
  | limit | number | No | Items per page (default: 20) |

- Body:
  ```json
  {
    "name": "string - User's full name",
    "email": "string - Valid email address"
  }
  ```

**Response**
- `200 OK`:
  ```json
  {
    "data": { ... },
    "meta": { "page": 1, "total": 100 }
  }
  ```
- `400 Bad Request`: Validation errors
- `401 Unauthorized`: Missing/invalid token
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error

**Example**
```bash
curl -X POST https://api.example.com/users \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "John", "email": "john@example.com"}'
```
```

---

## Output Formats

Generate documentation in the format most appropriate for the project:

### OpenAPI/Swagger (if detected)
```yaml
openapi: 3.0.0
paths:
  /api/users:
    get:
      summary: List users
      parameters: [...]
      responses: [...]
```

### Markdown Documentation
- README-style documentation
- Organized by resource/domain

### Type Definitions
- Request/Response TypeScript interfaces
- Zod schemas with documentation

---

## Additional Documentation

- Rate limiting policies
- Error response formats
- Pagination patterns
- Authentication flows
- Webhook payloads (if applicable)
- WebSocket events (if applicable)
