import { Context, Effect, Layer, Schema } from "effect"
import BetterSqlite3 from "better-sqlite3"
import { FileSystem, Path } from "@effect/platform"
import { homeDir } from "./homeDir.ts"
import type { Worker } from "./Worker.ts"

// -- Schema ------------------------------------------------------------------

export class Repository extends Schema.Class<Repository>("Repository")({
  id: Schema.Number,
  name: Schema.String,
  path: Schema.String,
  createdAt: Schema.Number,
}) {}

export class DbWorker extends Schema.Class<DbWorker>("DbWorker")({
  id: Schema.Number,
  repositoryId: Schema.Number,
  name: Schema.String,
  branch: Schema.String,
  prdPath: Schema.String,
  state: Schema.Literal("stopped", "running"),
  worktreePath: Schema.String,
  createdAt: Schema.Number,
}) {}

// -- Database service --------------------------------------------------------

export interface DatabaseService {
  readonly getRepository: (name: string) => Effect.Effect<Repository | undefined>
  readonly createRepository: (name: string, path: string) => Effect.Effect<Repository>
  readonly listRepositories: Effect.Effect<ReadonlyArray<Repository>>
  readonly getWorker: (name: string) => Effect.Effect<DbWorker | undefined>
  readonly getWorkerById: (id: number) => Effect.Effect<DbWorker | undefined>
  readonly createWorker: (
    repositoryId: number,
    name: string,
    branch: string,
    prdPath: string,
    worktreePath: string,
  ) => Effect.Effect<DbWorker>
  readonly updateWorkerState: (name: string, state: "stopped" | "running") => Effect.Effect<void>
  readonly listWorkers: (repositoryId?: number) => Effect.Effect<ReadonlyArray<DbWorker>>
  readonly deleteWorker: (name: string) => Effect.Effect<void>
}

export class Database extends Context.Tag("Database")<Database, DatabaseService>() {}

// -- Database initialization -------------------------------------------------

const getDbPath = Effect.gen(function* () {
  const pathService = yield* Path.Path
  return pathService.join(homeDir, ".ralph", "ralph.db")
})

const initializeSchema = (db: BetterSqlite3.Database) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id INTEGER NOT NULL,
      name TEXT NOT NULL UNIQUE,
      branch TEXT NOT NULL,
      prd_path TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('stopped', 'running')),
      worktree_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_workers_repository_id ON workers(repository_id);
    CREATE INDEX IF NOT EXISTS idx_workers_name ON workers(name);
  `)
}

// -- Migration from workers.json ---------------------------------------------

const migrateWorkersJson = (db: BetterSqlite3.Database) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const workersJsonPath = pathService.join(homeDir, ".ralph", "workers.json")

    const exists = yield* fs.exists(workersJsonPath)
    if (!exists) return

    const content = yield* fs.readFileString(workersJsonPath).pipe(
      Effect.catchAll(() => Effect.succeed("{}")),
    )

    const data = JSON.parse(content) as { workers?: Array<Worker> }
    if (!data.workers || data.workers.length === 0) return

    // Extract unique repositories from worker paths
    const repoMap = new Map<string, { name: string; path: string }>()

    for (const worker of data.workers) {
      // Extract repo path from worktree path
      // Assumes structure: <repo>/.ralph/worktrees/<worker-name>
      const parts = worker.worktreePath.split(pathService.sep)
      const ralphIdx = parts.lastIndexOf(".ralph")
      if (ralphIdx > 0) {
        const repoPath = parts.slice(0, ralphIdx).join(pathService.sep)
        const repoName = pathService.basename(repoPath)
        if (!repoMap.has(repoName)) {
          repoMap.set(repoName, { name: repoName, path: repoPath })
        }
      }
    }

    // Insert repositories
    const insertRepo = db.prepare(
      "INSERT OR IGNORE INTO repositories (name, path, created_at) VALUES (?, ?, ?)",
    )

    for (const { name, path } of repoMap.values()) {
      insertRepo.run(name, path, Date.now())
    }

    // Get repository IDs
    const getRepoId = db.prepare<unknown[], { id: number }>(
      "SELECT id FROM repositories WHERE name = ?",
    )

    // Insert workers
    const insertWorker = db.prepare(
      "INSERT OR IGNORE INTO workers (repository_id, name, branch, prd_path, state, worktree_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )

    for (const worker of data.workers) {
      const parts = worker.worktreePath.split(pathService.sep)
      const ralphIdx = parts.lastIndexOf(".ralph")
      if (ralphIdx > 0) {
        const repoPath = parts.slice(0, ralphIdx).join(pathService.sep)
        const repoName = pathService.basename(repoPath)
        const repo = getRepoId.get(repoName)
        if (repo) {
          insertWorker.run(
            repo.id,
            worker.name,
            worker.branch,
            worker.prdPath,
            "stopped",
            worker.worktreePath,
            worker.createdAt,
          )
        }
      }
    }

    // Backup and remove workers.json
    const backupPath = pathService.join(homeDir, ".ralph", "workers.json.migrated")
    yield* fs.copy(workersJsonPath, backupPath).pipe(Effect.catchAll(() => Effect.void))
    yield* fs.remove(workersJsonPath).pipe(Effect.catchAll(() => Effect.void))
  })

// -- DatabaseLive layer ------------------------------------------------------

export const DatabaseLive = Layer.scoped(
  Database,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const dbPath = yield* getDbPath
    const dbDir = dbPath.split("/").slice(0, -1).join("/")

    yield* fs.makeDirectory(dbDir, { recursive: true }).pipe(
      Effect.catchAll(() => Effect.void),
    )

    const db = new BetterSqlite3(dbPath)

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        db.close()
      }),
    )

    initializeSchema(db)
    yield* migrateWorkersJson(db)

    const service: DatabaseService = {
      getRepository: (name) =>
        Effect.sync(() => {
          const row = db
            .prepare<unknown[], { id: number; name: string; path: string; created_at: number }>(
              "SELECT id, name, path, created_at FROM repositories WHERE name = ?",
            )
            .get(name)
          if (!row) return undefined
          return new Repository({
            id: row.id,
            name: row.name,
            path: row.path,
            createdAt: row.created_at,
          })
        }),

      createRepository: (name, path) =>
        Effect.sync(() => {
          const stmt = db.prepare(
            "INSERT INTO repositories (name, path, created_at) VALUES (?, ?, ?)",
          )
          const info = stmt.run(name, path, Date.now())
          return new Repository({
            id: Number(info.lastInsertRowid),
            name,
            path,
            createdAt: Date.now(),
          })
        }),

      listRepositories: Effect.sync(() => {
        const rows = db
          .prepare<unknown[], { id: number; name: string; path: string; created_at: number }>(
            "SELECT id, name, path, created_at FROM repositories ORDER BY created_at DESC",
          )
          .all()
        return rows.map(
          row =>
            new Repository({
              id: row.id,
              name: row.name,
              path: row.path,
              createdAt: row.created_at,
            }),
        )
      }),

      getWorker: (name) =>
        Effect.sync(() => {
          const row = db
            .prepare<
              unknown[],
              {
                id: number
                repository_id: number
                name: string
                branch: string
                prd_path: string
                state: "stopped" | "running"
                worktree_path: string
                created_at: number
              }
            >(
              "SELECT id, repository_id, name, branch, prd_path, state, worktree_path, created_at FROM workers WHERE name = ?",
            )
            .get(name)
          if (!row) return undefined
          return new DbWorker({
            id: row.id,
            repositoryId: row.repository_id,
            name: row.name,
            branch: row.branch,
            prdPath: row.prd_path,
            state: row.state,
            worktreePath: row.worktree_path,
            createdAt: row.created_at,
          })
        }),

      getWorkerById: (id) =>
        Effect.sync(() => {
          const row = db
            .prepare<
              unknown[],
              {
                id: number
                repository_id: number
                name: string
                branch: string
                prd_path: string
                state: "stopped" | "running"
                worktree_path: string
                created_at: number
              }
            >(
              "SELECT id, repository_id, name, branch, prd_path, state, worktree_path, created_at FROM workers WHERE id = ?",
            )
            .get(id)
          if (!row) return undefined
          return new DbWorker({
            id: row.id,
            repositoryId: row.repository_id,
            name: row.name,
            branch: row.branch,
            prdPath: row.prd_path,
            state: row.state,
            worktreePath: row.worktree_path,
            createdAt: row.created_at,
          })
        }),

      createWorker: (repositoryId, name, branch, prdPath, worktreePath) =>
        Effect.sync(() => {
          const stmt = db.prepare(
            "INSERT INTO workers (repository_id, name, branch, prd_path, state, worktree_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          const info = stmt.run(repositoryId, name, branch, prdPath, "stopped", worktreePath, Date.now())
          return new DbWorker({
            id: Number(info.lastInsertRowid),
            repositoryId,
            name,
            branch,
            prdPath,
            state: "stopped",
            worktreePath,
            createdAt: Date.now(),
          })
        }),

      updateWorkerState: (name, state) =>
        Effect.sync(() => {
          db.prepare("UPDATE workers SET state = ? WHERE name = ?").run(state, name)
        }),

      listWorkers: (repositoryId) =>
        Effect.sync(() => {
          const query = repositoryId
            ? "SELECT id, repository_id, name, branch, prd_path, state, worktree_path, created_at FROM workers WHERE repository_id = ? ORDER BY created_at DESC"
            : "SELECT id, repository_id, name, branch, prd_path, state, worktree_path, created_at FROM workers ORDER BY created_at DESC"

          const rows = repositoryId
            ? db
                .prepare<
                  unknown[],
                  {
                    id: number
                    repository_id: number
                    name: string
                    branch: string
                    prd_path: string
                    state: "stopped" | "running"
                    worktree_path: string
                    created_at: number
                  }
                >(query)
                .all(repositoryId)
            : db
                .prepare<
                  unknown[],
                  {
                    id: number
                    repository_id: number
                    name: string
                    branch: string
                    prd_path: string
                    state: "stopped" | "running"
                    worktree_path: string
                    created_at: number
                  }
                >(query)
                .all()

          return rows.map(
            row =>
              new DbWorker({
                id: row.id,
                repositoryId: row.repository_id,
                name: row.name,
                branch: row.branch,
                prdPath: row.prd_path,
                state: row.state,
                worktreePath: row.worktree_path,
                createdAt: row.created_at,
              }),
          )
        }),

      deleteWorker: (name) =>
        Effect.sync(() => {
          db.prepare("DELETE FROM workers WHERE name = ?").run(name)
        }),
    }

    return service
  }),
)
