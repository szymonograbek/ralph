// Mock backend server for testing web UI
const server = Bun.serve({
  port: 3001,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    // CORS headers
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    }

    if (req.method === "OPTIONS") {
      return new Response(null, { headers })
    }

    // GET /repositories
    if (path === "/repositories" && req.method === "GET") {
      return Response.json(
        [
          {
            id: 1,
            name: "test-repo",
            path: "/Users/test/repo",
            createdAt: Date.now() - 86400000,
          },
          {
            id: 2,
            name: "another-repo",
            path: "/Users/test/another",
            createdAt: Date.now() - 172800000,
          },
        ],
        { headers }
      )
    }

    // POST /repositories
    if (path === "/repositories" && req.method === "POST") {
      return Response.json({ ok: true }, { headers })
    }

    // GET /repositories/:name/workers
    if (path.match(/^\/repositories\/[^/]+\/workers$/) && req.method === "GET") {
      return Response.json(
        [
          {
            name: "worker-1",
            worktreePath: "/Users/test/.ralph/worktrees/worker-1",
            branch: "ralph-worker-1",
            prdPath: "/Users/test/.ralph/worktrees/worker-1/PRD.json",
            createdAt: Date.now() - 3600000,
          },
          {
            name: "worker-2",
            worktreePath: "/Users/test/.ralph/worktrees/worker-2",
            branch: "ralph-worker-2",
            prdPath: "/Users/test/.ralph/worktrees/worker-2/PRD.json",
            createdAt: Date.now() - 7200000,
          },
        ],
        { headers }
      )
    }

    // POST /repositories/:name/workers
    if (path.match(/^\/repositories\/[^/]+\/workers$/) && req.method === "POST") {
      return Response.json({ ok: true }, { headers })
    }

    // DELETE /repositories/:name/workers/:id
    if (path.match(/^\/repositories\/[^/]+\/workers\/[^/]+$/) && req.method === "DELETE") {
      return Response.json({ ok: true }, { headers })
    }

    // GET /workers/:name
    if (path.match(/^\/workers\/[^/]+$/) && req.method === "GET") {
      const workerName = path.split("/")[2]
      return Response.json(
        {
          name: workerName,
          status: "running",
          startedAt: Date.now() - 1800000,
          currentTask: "task-1",
          iterationCount: 5,
        },
        { headers }
      )
    }

    // GET /repositories/:name/workers/:id (worker detail)
    if (path.match(/^\/repositories\/[^/]+\/workers\/[^/]+$/) && req.method === "GET") {
      return Response.json(
        {
          state: {
            name: "worker-1",
            status: "running",
            startedAt: Date.now() - 1800000,
            currentTask: "task-2",
            iterationCount: 7,
          },
          prd: {
            project: {
              name: "Test Project",
              description: "A test project for development",
            },
            userStories: [
              {
                id: "task-1",
                title: "Setup project structure",
                description: "Create initial project structure with all necessary directories",
                acceptanceCriteria: [
                  "All directories are created",
                  "Configuration files are in place",
                  "README is updated",
                ],
                passes: true,
                notes: "",
              },
              {
                id: "task-2",
                title: "Implement core features",
                description: "Build the main features of the application",
                acceptanceCriteria: [
                  "Feature A is implemented",
                  "Feature B is implemented",
                  "Tests are passing",
                ],
                passes: false,
                notes: "In progress",
              },
              {
                id: "task-3",
                title: "Add error handling",
                description: "Implement comprehensive error handling",
                acceptanceCriteria: [
                  "All errors are caught",
                  "User-friendly error messages",
                  "Logging is in place",
                ],
                passes: false,
                notes: "",
              },
            ],
          },
        },
        { headers }
      )
    }

    return Response.json({ error: "Not found" }, { status: 404, headers })
  },
})

console.log(`Mock server running at http://localhost:${server.port}`)
