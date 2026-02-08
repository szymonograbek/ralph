# PRD Examples

## REST API Feature

Plan: "Add blog post CRUD with categories"

```json
{
  "project": {
    "name": "blog-api",
    "description": "REST API for blog posts with category management"
  },
  "userStories": [
    {
      "id": "task-1",
      "title": "Add Post and Category models",
      "description": "Create DB models with migrations.",
      "acceptanceCriteria": [
        "Post model has title, body, categoryId fields",
        "Category model has name, slug fields",
        "Migrations run without errors"
      ],
      "passes": false,
      "notes": ""
    },
    {
      "id": "task-2",
      "title": "Add Category CRUD endpoints",
      "description": "GET/POST/PUT/DELETE /categories.",
      "acceptanceCriteria": [
        "All four endpoints return correct status codes",
        "GET /categories returns array of categories",
        "POST /categories creates and returns new category"
      ],
      "passes": false,
      "notes": ""
    },
    {
      "id": "task-3",
      "title": "Add Post CRUD endpoints",
      "description": "GET/POST/PUT/DELETE /posts with category filter.",
      "acceptanceCriteria": [
        "All four endpoints return correct status codes",
        "GET /posts?category=slug filters by category",
        "Posts include category in response"
      ],
      "passes": false,
      "notes": ""
    },
    {
      "id": "task-4",
      "title": "Add input validation and tests",
      "description": "Validate required fields, add unit+integration tests.",
      "acceptanceCriteria": [
        "Missing required fields return 400 with error message",
        "Unit tests cover all endpoints",
        "npm test passes"
      ],
      "passes": false,
      "notes": ""
    }
  ]
}
```

## CLI Tool

Plan: "Build JSON/YAML converter CLI"

```json
{
  "project": {
    "name": "json-yaml-cli",
    "description": "Bidirectional JSON/YAML converter with stdin support"
  },
  "userStories": [
    {
      "id": "task-1",
      "title": "Set up CLI scaffolding",
      "description": "commander.js with convert command.",
      "acceptanceCriteria": [
        "--help prints usage",
        "convert command accepts input and output args"
      ],
      "passes": false,
      "notes": ""
    },
    {
      "id": "task-2",
      "title": "Implement bidirectional conversion",
      "description": "JSON<->YAML, auto-detect by extension.",
      "acceptanceCriteria": [
        "JSON to YAML produces valid YAML output",
        "YAML to JSON produces valid JSON output",
        "Round-trip preserves data"
      ],
      "passes": false,
      "notes": ""
    },
    {
      "id": "task-3",
      "title": "Add error handling and stdin support",
      "description": "Graceful errors for invalid input, pipe support via -.",
      "acceptanceCriteria": [
        "Invalid JSON/YAML prints descriptive error to stderr",
        "echo '{\"a\":1}' | cli convert - - produces YAML on stdout",
        "Non-zero exit code on failure"
      ],
      "passes": false,
      "notes": ""
    }
  ]
}
```

## Story Sizing

| Complexity | Stories |
|------------|---------|
| Simple CRUD | 3-5 |
| CLI tool | 4-6 |
| Auth system | 6-10 |

Rule: If description exceeds 3 sentences, split the story.
