import { FileSystem, Path } from "@effect/platform"
import { Context, Deferred, Effect, FiberMap, HashMap, Layer, Ref, Schema } from "effect"
import { RalphConfig, RalphConfigLive } from "../Config.ts"
import { ProviderLive } from "../ProviderRegistry.ts"
import { TerminalUILive } from "../TerminalUI.ts"
import { loadRegistry } from "../Worker.ts"
import { runLoop } from "../Loop.ts"
import { extractErrorMessage } from "../extractErrorMessage.ts"

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
  readonly startWorker: (name: string) => Effect.Effect<void, Error, FileSystem.FileSystem | Path.Path>
  readonly stopWorker: (name: string) => Effect.Effect<void, Error>
  readonly workerStatus: (name: string) => Effect.Effect<WorkerFiberState, Error>
  readonly allWorkerStates: Effect.Effect<ReadonlyArray<WorkerFiberState>>
  readonly shutdown: Effect.Effect<void>
}

export class OrchestratorTag extends Context.Tag("Orchestrator")<OrchestratorTag, Orchestrator>() {}

// -- Build per-worker layer --------------------------------------------------

const buildWorkerLayer = (workerName: string) =>
  Effect.gen(function* () {
    const registry = yield* loadRegistry
    const worker = registry.workers.find(w => w.name === workerName)
    if (!worker) {
      return yield* Effect.fail(new Error(`Worker '${workerName}' not found in registry`))
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
              onSuccess: () => updateState(name, s => new WorkerFiberState({
                ...s,
                status: "completed",
                currentTask: undefined,
              })),
              onFailure: (err) =>
                updateState(name, s => new WorkerFiberState({
                  ...s,
                  status: "errored",
                  error: extractErrorMessage(err),
                  currentTask: undefined,
                })),
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

          yield* FiberMap.remove(fibers, name)
          yield* Ref.update(stateRef, map => HashMap.remove(map, name))
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
    }

    return service
  }),
)
