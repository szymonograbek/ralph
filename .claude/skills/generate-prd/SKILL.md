---
name: generate-prd
description: Generate PRD.json for Ralph autonomous loops. Use when creating tasks from a plan or initializing a Ralph project.
---

# Generate PRD

Creates properly structured PRD.json files for Ralph autonomous coding loops.

## PRD Schema

```json
{
  "project": {
    "name": "project-name",
    "description": "One-line project summary"
  },
  "userStories": [
    {
      "id": "task-1",
      "title": "Short imperative description",
      "description": "What to build and where",
      "acceptanceCriteria": [
        "Specific, testable condition 1",
        "Specific, testable condition 2"
      ],
      "passes": false,
      "notes": ""
    }
  ]
}
```

All fields required. `passes` always starts `false`. `notes` always starts `""` (populated by Claude during loop execution).

## Workflow

1. **Gather input** — plan/requirements from user
2. **Analyze scope** — identify discrete, independently verifiable units of work
3. **Structure stories** — apply decomposition rules (see [task-design.md](./references/task-design.md))
4. **Generate PRD** — write valid JSON to `.ralph/PRD.json`
5. **Verify** — stories are atomic, verifiable, correctly ordered

## Task ID Convention

Pattern: `task-N` where N is sequential integer starting at 1.

## Critical Rules

| Rule | Why |
|------|-----|
| Each story independently verifiable | Loop must know when story passes |
| Stories ordered by dependency | Later stories assume earlier ones complete |
| No overlapping scope | Prevents duplicate work between iterations |
| Title is imperative verb phrase | "Add X", "Implement Y", "Fix Z" |
| `acceptanceCriteria` has concrete checks | Claude needs clear pass/fail signal |
| `description` says what + where | Affected files/modules, deliverable |

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Stories too large | Break into 1-session chunks |
| Criteria vague or missing | Add specific, testable conditions |
| Acceptance criteria in description | Move to `acceptanceCriteria` array |
| Circular dependencies | Reorder or merge stories |
| Implementation details in title | Title = what, description = how |

## When Input is Unclear

Ask user to clarify:
- Acceptance criteria for ambiguous requirements
- Priority when multiple valid orderings exist
- Scope boundaries for large features

## See Also

- [task-design.md](./references/task-design.md) — detailed decomposition guidelines
- [examples.md](./references/examples.md) — real PRD examples
