import { FileSystem, Path } from "@effect/platform"
import { Context, Deferred, Effect, FiberMap, HashMap, Layer, Ref, Schema } from "effect"
import { RalphConfig, RalphConfigLive } from "../Config.ts"
import { ProviderLive } from "../ProviderRegistry.ts"
import { TerminalUILive } from "../TerminalUI.ts"
import { Worker } from "../Worker.ts"
import { runLoop } from "../Loop.ts"
import { extractErrorMessage } from "../extractErrorMessage.ts"
import { Database, DbWorker, Repository } from "../Database.ts"

// -- WorkerFiberState --------------------------------------------------------

export class WorkerFiberState extends Schema.Class<WorkerFiberState>("WorkerFiberState")({
  name: Schema.String,
  status: Schema.Literal("running", "completed", "errored"),
  startedAt: Schema.Number,
  currentTask: Schema.optional(Schema.String),
  iterationCount: Schema.Number,
  error: Schema.optional(Schema.String),
}) {}

// -- Shutdown signal ---------------------------------------------------------

export class ShutdownSignal extends Context.Tag("ShutdownSignal")<
  ShutdownSignal,
  Deferred.Deferred<void>
>() {}

// -- Orchestrator service ----------------------------------------------------

export interface Orchestrator {
  readonly startWorker: (name: string) => Effect.Effect<void, Error, FileSystem.FileSystem | Path.Path | Database>
  readonly stopWorker: (name: string) => Effect.Effect<void, Error, Database>
  readonly workerStatus: (name: string) => Effect.Effect<WorkerFiberState, Error>
  readonly allWorkerStates: Effect.Effect<ReadonlyArray<WorkerFiberState>>
  readonly shutdown: Effect.Effect<void>
  readonly listRepositories: Effect.Effect<ReadonlyArray<Repository>, Error, Database>
  readonly createRepository: (dir: string) => Effect.Effect<void, unknown, FileSystem.FileSystem | Path.Path | Database>
  readonly listWorkers: (repoName: string) => Effect.Effect<ReadonlyArray<Worker>, Error, Database>
  readonly createAndStartWorker: (repoName: string, workerName: string, planMessage: string) => Effect.Effect<void, Error, FileSystem.FileSystem | Path.Path | Database>
}

export class OrchestratorTag extends Context.Tag("Orchestrator")<OrchestratorTag, Orchestrator>() {}

// -- Build per-worker layer --------------------------------------------------

const buildWorkerLayer = (workerName: string) =>
  Effect.gen(function* () {
    const db = yield* Database
    const worker = yield* db.getWorker(workerName)
    if (!worker) {
      return yield* Effect.fail(new Error(`Worker '${workerName}' not found in database`))
    }

    const pathService = yield* Path.Path
    const dir = pathService.join(worker.worktreePath, ".ralph")

    const configLayer = RalphConfigLive({ dir })
    const uiLayer = TerminalUILive(true) // always quiet in daemon
    const providerLayer = Layer.provide(ProviderLive, Layer.merge(configLayer, uiLayer))

    return {
      layer: Layer.merge(Layer.merge(configLayer, providerLayer), uiLayer),
      cwd: worker.worktreePath,
    }
  })

// -- OrchestratorLive --------------------------------------------------------

export const OrchestratorLive = Layer.scoped(
  OrchestratorTag,
  Effect.gen(function* () {
    const shutdownSignal = yield* ShutdownSignal
    const fibers = yield* FiberMap.make<string, void, Error>()
    const stateRef = yield* Ref.make<HashMap.HashMap<string, WorkerFiberState>>(HashMap.empty())

    const updateState = (name: string, fn: (s: WorkerFiberState) => WorkerFiberState) =>
      Ref.update(stateRef, map => {
        const existing = HashMap.get(map, name)
        if (existing._tag === "None") return map
        return HashMap.set(map, name, fn(existing.value))
      })

    const service: Orchestrator = {
      startWorker: (name) =>
        Effect.gen(function* () {
          const states = yield* Ref.get(stateRef)
          const existing = HashMap.get(states, name)
          if (existing._tag === "Some" && existing.value.status === "running") {
            return yield* Effect.fail(new Error(`Worker '${name}' already running`))
          }

          const db = yield* Database
          const worker = yield* db.getWorker(name)
          if (!worker) {
            return yield* Effect.fail(new Error(`Worker '${name}' not found`))
          }

          const { layer } = yield* buildWorkerLayer(name)

          const initialState = new WorkerFiberState({
            name,
            status: "running",
            startedAt: Date.now(),
            currentTask: undefined,
            iterationCount: 0,
            error: undefined,
          })

          yield* Ref.update(stateRef, map => HashMap.set(map, name, initialState))
          yield* db.updateWorkerState(name, "running")

          const loopEffect = runLoop(true, {
            onIterationStart: (taskTitle) =>
              updateState(name, s => new WorkerFiberState({
                ...s,
                currentTask: taskTitle,
                iterationCount: s.iterationCount + 1,
              })),
            onIterationEnd: () => Effect.void,
          }).pipe(
            Effect.provide(layer),
            Effect.matchEffect({
              onSuccess: () => Effect.all([
                updateState(name, s => new WorkerFiberState({
                  ...s,
                  status: "completed",
                  currentTask: undefined,
                })),
                db.updateWorkerState(name, "stopped"),
              ]),
              onFailure: (err) =>
                Effect.all([
                  updateState(name, s => new WorkerFiberState({
                    ...s,
                    status: "errored",
                    error: extractErrorMessage(err),
                    currentTask: undefined,
                  })),
                  db.updateWorkerState(name, "stopped"),
                ]),
            }),
          )

          yield* FiberMap.run(fibers, name, loopEffect)
        }),

      stopWorker: (name) =>
        Effect.gen(function* () {
          const states = yield* Ref.get(stateRef)
          const existing = HashMap.get(states, name)
          if (existing._tag === "None") {
            return yield* Effect.fail(new Error(`Worker '${name}' not found`))
          }

          const db = yield* Database
          yield* FiberMap.remove(fibers, name)
          yield* Ref.update(stateRef, map => HashMap.remove(map, name))
          yield* db.updateWorkerState(name, "stopped")
        }),

      workerStatus: (name) =>
        Effect.gen(function* () {
          const states = yield* Ref.get(stateRef)
          const state = HashMap.get(states, name)
          if (state._tag === "None") {
            return yield* Effect.fail(new Error(`Worker '${name}' not tracked by orchestrator`))
          }
          return state.value
        }),

      allWorkerStates: Ref.get(stateRef).pipe(
        Effect.map(map => Array.from(HashMap.values(map)))
      ),

      shutdown: FiberMap.clear(fibers).pipe(
        Effect.andThen(Ref.set(stateRef, HashMap.empty())),
        Effect.andThen(Deferred.complete(shutdownSignal, Effect.void)),
      ),

      listRepositories: Effect.gen(function* () {
        const db = yield* Database
        return yield* db.listRepositories
      }),

      createRepository: (dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const pathService = yield* Path.Path
          const db = yield* Database

          // Validate directory exists
          const exists = yield* fs.exists(dir)
          if (!exists) {
            return yield* Effect.fail(new Error(`Directory does not exist: ${dir}`))
          }

          // Check if it's a git repository
          const gitDir = pathService.join(dir, ".git")
          const isGitRepo = yield* fs.exists(gitDir)
          if (!isGitRepo) {
            return yield* Effect.fail(new Error(`Not a git repository: ${dir}`))
          }

          // Create .ralph directory
          const ralphDir = pathService.join(dir, ".ralph")
          yield* fs.makeDirectory(ralphDir, { recursive: true }).pipe(
            Effect.catchAll(() => Effect.void),
          )

          // Register repository in database
          const repoName = pathService.basename(dir)
          const existing = yield* db.getRepository(repoName)
          if (!existing) {
            yield* db.createRepository(repoName, dir)
          }
        }),

      listWorkers: (repoName) =>
        Effect.gen(function* () {
          const db = yield* Database
          const repo = yield* db.getRepository(repoName)
          if (!repo) {
            return yield* Effect.fail(new Error(`Repository '${repoName}' not found`))
          }

          const dbWorkers = yield* db.listWorkers(repo.id)
          // Convert DbWorker to Worker for API compatibility
          return dbWorkers.map(
            w =>
              new Worker({
                name: w.name,
                worktreePath: w.worktreePath,
                branch: w.branch,
                prdPath: w.prdPath,
                createdAt: w.createdAt,
              }),
          )
        }),

      createAndStartWorker: (repoName, workerName, planMessage) =>
        Effect.gen(function* () {
          const db = yield* Database
          const fs = yield* FileSystem.FileSystem
          const pathService = yield* Path.Path

          // Get repository
          const repo = yield* db.getRepository(repoName)
          if (!repo) {
            return yield* Effect.fail(new Error(`Repository '${repoName}' not found`))
          }

          // Check if worker already exists
          const existing = yield* db.getWorker(workerName)
          if (existing) {
            return yield* Effect.fail(new Error(`Worker '${workerName}' already exists`))
          }

          // Create worktree directory
          const worktreePath = pathService.join(repo.path, ".ralph", "worktrees", workerName)
          yield* fs.makeDirectory(worktreePath, { recursive: true }).pipe(
            Effect.mapError((err) => new Error(`Failed to create directory: ${extractErrorMessage(err)}`)),
          )

          // Create git worktree
          const branch = `ralph/${workerName}`
          yield* Effect.tryPromise({
            try: () =>
              Bun.spawn(["git", "worktree", "add", "-b", branch, worktreePath], {
                cwd: repo.path,
                stdio: ["ignore", "pipe", "pipe"],
              }).exited,
            catch: (err) => new Error(`Failed to create git worktree: ${String(err)}`),
          })

          // Create .ralph directory in worktree
          const ralphDir = pathService.join(worktreePath, ".ralph")
          yield* fs.makeDirectory(ralphDir, { recursive: true }).pipe(
            Effect.mapError((err) => new Error(`Failed to create .ralph directory: ${extractErrorMessage(err)}`)),
          )

          // Generate PRD.json using ralph plan command
          const prdPath = pathService.join(ralphDir, "PRD.json")
          yield* Effect.tryPromise({
            try: () =>
              Bun.spawn(["ralph", "plan", planMessage], {
                cwd: worktreePath,
                stdio: ["ignore", "pipe", "pipe"],
              }).exited,
            catch: (err) => new Error(`Failed to generate PRD: ${String(err)}`),
          })

          // Verify PRD.json was created
          const prdExists = yield* fs.exists(prdPath).pipe(
            Effect.mapError((err) => new Error(`Failed to check PRD existence: ${extractErrorMessage(err)}`)),
          )
          if (!prdExists) {
            return yield* Effect.fail(new Error("PRD.json not created by ralph plan"))
          }

          // Create worker in database
          yield* db.createWorker(repo.id, workerName, branch, prdPath, worktreePath)

          // Start the worker
          yield* service.startWorker(workerName).pipe(
            Effect.mapError((err) => new Error(`Failed to start worker: ${extractErrorMessage(err)}`)),
          )
        }).pipe(
          Effect.mapError((err) => (err instanceof Error ? err : new Error(extractErrorMessage(err)))),
        ),
    }

    return service
  }),
)
