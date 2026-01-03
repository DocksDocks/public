---
allowed-tools: Read, Grep, Glob, Write
description: Generate API documentation based on detected framework
---

# API Documentation Generator

Analyze the codebase and generate comprehensive API documentation matching the project's framework.

## Phase 0: Project Detection

First, identify the API framework and tools:
1. Check `package.json` for framework (Fastify, Express, Next.js, Hono, etc.)
2. Check for existing OpenAPI/Swagger setup
3. Check for validation libraries (Zod, Joi, TypeBox, etc.)
4. Check for authentication patterns
5. Identify the package manager for script commands

Document detected setup before generating.

---

## Discovery Phase

1. Find all API endpoints/routes
2. Identify request/response schemas
3. Extract authentication requirements
4. Find middleware and validation rules
5. Locate existing documentation

---

## Stack-Specific Documentation

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

### If Drizzle ORM Detected
- Document database schema and relations
- Include entity relationship diagram
- Document type exports for API contracts
```typescript
// Use Drizzle types for API documentation
import { users } from './schema'
type User = typeof users.$inferSelect
type NewUser = typeof users.$inferInsert

// Document query patterns
/**
 * @returns User with related posts
 */
const getUserWithPosts = (id: string) =>
  db.query.users.findFirst({
    where: eq(users.id, id),
    with: { posts: true }
  })
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
