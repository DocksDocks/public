---
allowed-tools: Read, Grep, Glob, Write
description: Generate or update API documentation
---

# API Documentation Generator

Analyze the codebase and generate comprehensive API documentation.

## Discovery Phase
1. Find all API endpoints/routes
2. Identify request/response schemas
3. Extract authentication requirements
4. Find middleware and validation rules
5. Locate existing documentation

## Documentation Structure

### For Each Endpoint
```markdown
## [METHOD] /path/to/endpoint

**Description**: What this endpoint does

**Authentication**: Required/Optional (type)

**Request**
- Headers: `Authorization: Bearer <token>`
- Query Params: `?page=1&limit=10`
- Body:
```json
{
  "field": "type - description"
}
```

**Response**
- 200 OK:
```json
{
  "data": {...}
}
```
- 400 Bad Request: Validation errors
- 401 Unauthorized: Missing/invalid token
- 500 Internal Error: Server error

**Example**
```bash
curl -X POST https://api.example.com/endpoint \
  -H "Authorization: Bearer token" \
  -d '{"field": "value"}'
```
```

## Output
Generate documentation in the format most appropriate for the project:
- OpenAPI/Swagger spec (if using)
- Markdown documentation
- README section
- Postman collection export
