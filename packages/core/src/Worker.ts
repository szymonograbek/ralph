import { FileSystem, Path } from "@effect/platform"
import { Effect, Schema } from "effect"
import { homeDir } from "./homeDir.ts"

/**
 * Worker represents isolated git worktree for parallel Ralph work.
 * Each worker has dedicated worktree, branch, PRD.json.
 * Enables multiple features/fixes in parallel without context conflicts.
 */
export class Worker extends Schema.Class<Worker>("Worker")({
  name: Schema.String,
  worktreePath: Schema.String,
  branch: Schema.String,
  prdPath: Schema.String,
  createdAt: Schema.Number,
}) {}

/**
 * WorkerState discriminated union: stopped | running with metrics.
 * ProcessManager.status maps to this schema.
 */
const WorkerStateStopped = Schema.Struct({
  status: Schema.Literal("stopped"),
})

const WorkerStateRunning = Schema.Struct({
  status: Schema.Literal("running"),
  pid: Schema.Number,
  uptime: Schema.Number,
  memory: Schema.Number,
  cpu: Schema.Number,
})

export const WorkerState = Schema.Union(WorkerStateStopped, WorkerStateRunning)
export type WorkerState = Schema.Schema.Type<typeof WorkerState>

/**
 * WorkerRegistry persists worker list to ~/.ralph/workers.json.
 * Single source of truth for active workers across repo.
 */
export class WorkerRegistry extends Schema.Class<WorkerRegistry>("WorkerRegistry")({
  workers: Schema.Array(Worker),
}) {}

const emptyRegistry = new WorkerRegistry({ workers: [] })

const getRegistryPath = Effect.gen(function* () {
  const pathService = yield* Path.Path
  return pathService.join(homeDir, ".ralph", "workers.json")
})

export const loadRegistry = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const registryPath = yield* getRegistryPath
  const content = yield* fs.readFileString(registryPath).pipe(
    Effect.catchAll(() => Effect.succeed(JSON.stringify(emptyRegistry))),
  )
  return yield* Schema.decode(WorkerRegistry)(JSON.parse(content))
}).pipe(Effect.catchAll(() => Effect.succeed(emptyRegistry)))

export const saveRegistry = (registry: WorkerRegistry) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const registryPath = yield* getRegistryPath
    const registryDir = pathService.dirname(registryPath)
    yield* fs.makeDirectory(registryDir, { recursive: true }).pipe(
      Effect.catchAll(() => Effect.void),
    )
    yield* fs.writeFileString(registryPath, JSON.stringify(registry, null, 2))
  })
