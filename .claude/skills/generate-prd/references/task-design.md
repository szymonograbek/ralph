# Task Design Guidelines

How to decompose plans into well-structured PRD user stories.

## Decomposition Principles

### Right-Sized Stories

**Too small:** "Add import statement" — trivial, creates loop overhead
**Too large:** "Implement authentication system" — can't complete in one iteration
**Just right:** "Add JWT token validation middleware" — one focused deliverable

Rule of thumb: Can Claude implement + verify in a single iteration with fresh context?

### Dependency Ordering

Stories execute sequentially. Each story can assume all previous stories completed successfully.

```
task-1: Create database schema       # Foundation
task-2: Add CRUD repository          # Depends on schema
task-3: Implement API endpoints      # Depends on repository
task-4: Add validation middleware    # Depends on endpoints
task-5: Write integration tests      # Depends on full stack
```

### Verifiability

Every story needs objective pass/fail criteria in `acceptanceCriteria`.

**Bad:** `["Performance is improved"]` — subjective
**Good:** `["Response time under 100ms for cached requests", "Cache hit rate logged to stdout"]`

**Bad:** `["Code is clean"]` — undefined scope
**Good:** `["No direct DB calls in handlers", "All queries in repository module", "Existing tests pass"]`

## Story Anatomy

### Title

- Imperative verb phrase: "Add", "Implement", "Create", "Fix", "Update"
- Scope in ~5-10 words
- No implementation details

Good: "Add user authentication endpoint"
Bad: "Implement OAuth2 with JWT using passport.js middleware"

### Description

What to build and where. Keep to 1-3 sentences. If longer, split the story.

### Acceptance Criteria

Array of specific, testable conditions. Each criterion should be independently verifiable.

```json
{
  "id": "task-3",
  "title": "Add login endpoint",
  "description": "POST /auth/login accepts email+password, returns JWT.",
  "acceptanceCriteria": [
    "POST /auth/login returns 200 with JWT for valid credentials",
    "POST /auth/login returns 401 for invalid credentials",
    "JWT contains user ID and email claims"
  ],
  "passes": false,
  "notes": ""
}
```

### Notes

Always `""` when generating. Claude populates this during loop execution with context for subsequent iterations.

## Splitting Large Features

Feature: "User authentication"

Split by layer:
```
task-1: Add User model with password hash
task-2: Create auth service with login/register
task-3: Add /auth/register endpoint
task-4: Add /auth/login endpoint
task-5: Add JWT middleware for protected routes
task-6: Add /auth/me endpoint (protected)
```

Split by functionality:
```
task-1: Registration flow (model + endpoint)
task-2: Login flow (service + endpoint + JWT)
task-3: Protected route middleware
```

## Anti-Patterns

### Catch-All Stories

Bad:
```json
{"title": "Fix remaining bugs", "description": "Address any issues found", "acceptanceCriteria": ["All bugs fixed"]}
```

Why: Undefined scope, can't verify completion.

### Premature Optimization

Bad:
```json
{"title": "Optimize database queries", "acceptanceCriteria": ["Queries are faster"]}
```

Why: No measurable criteria. If optimization needed, specify benchmark.

### Refactoring Without Deliverable

Bad:
```json
{"title": "Refactor utils", "description": "Clean up utility functions"}
```

Better:
```json
{
  "title": "Extract date utils to separate module",
  "description": "Move date formatting from utils.ts to date-utils.ts.",
  "acceptanceCriteria": ["All date imports updated", "Existing tests pass", "No date logic in utils.ts"]
}
```

## Testing Stories

Place after implementation stories they verify:

```
task-5: Implement payment processing
task-6: Add unit tests for payment service (mock external API)
task-7: Add integration tests for payment flow (test API credentials)
```
