import { Context, Effect, Schema } from "effect"
import { WorkerFiberState } from "./Orchestrator.ts"
import { socketPath } from "./paths.ts"

// -- Client service ----------------------------------------------------------

export interface OrchestratorClient {
  readonly isRunning: () => Effect.Effect<boolean>
  readonly startWorker: (name: string) => Effect.Effect<void, Error>
  readonly stopWorker: (name: string) => Effect.Effect<void, Error>
  readonly workerStatus: (name: string) => Effect.Effect<WorkerFiberState, Error>
  readonly allWorkerStates: () => Effect.Effect<ReadonlyArray<WorkerFiberState>, Error>
  readonly shutdown: () => Effect.Effect<void, Error>
}

export class OrchestratorClientTag extends Context.Tag("OrchestratorClient")<
  OrchestratorClientTag,
  OrchestratorClient
>() {}

// -- Implementation ----------------------------------------------------------

const fetchUnix = (path: string, init?: RequestInit) =>
  Effect.tryPromise({
    try: () => fetch(`http://localhost${path}`, {
      ...init,
      unix: socketPath,
    } as RequestInit),
    catch: (err) => new Error(`Orchestrator unreachable: ${err instanceof Error ? err.message : String(err)}`),
  })

const decodeJsonBody = <A, I>(response: Response, schema: Schema.Schema<A, I>) =>
  Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: () => new Error("Failed to parse orchestrator response"),
  }).pipe(
    Effect.flatMap(json => {
      if (response.ok) {
        return Schema.decodeUnknown(schema)(json).pipe(
          Effect.catchAll(err => Effect.fail(new Error(`Invalid response: ${String(err)}`)))
        )
      }
      const msg = typeof json === "object" && json !== null && "error" in json
        ? String((json as Record<string, unknown>).error)
        : `HTTP ${response.status}`
      return Effect.fail(new Error(msg))
    }),
  )

const checkOkResponse = (response: Response) =>
  Effect.gen(function* () {
    if (!response.ok) {
      const json = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: () => new Error(`HTTP ${response.status}`),
      })
      const msg = typeof json === "object" && json !== null && "error" in json
        ? String((json as Record<string, unknown>).error)
        : `HTTP ${response.status}`
      return yield* Effect.fail(new Error(msg))
    }
  })

export const makeOrchestratorClient = (): OrchestratorClient => ({
  isRunning: () =>
    fetchUnix("/workers").pipe(
      Effect.map(res => res.ok),
      Effect.catchAll(() => Effect.succeed(false)),
    ),

  startWorker: (name) =>
    fetchUnix(`/workers/${encodeURIComponent(name)}/start`, { method: "POST" }).pipe(
      Effect.flatMap(checkOkResponse),
    ),

  stopWorker: (name) =>
    fetchUnix(`/workers/${encodeURIComponent(name)}/stop`, { method: "POST" }).pipe(
      Effect.flatMap(checkOkResponse),
    ),

  workerStatus: (name) =>
    fetchUnix(`/workers/${encodeURIComponent(name)}`).pipe(
      Effect.flatMap(res => decodeJsonBody(res, WorkerFiberState)),
    ),

  allWorkerStates: () =>
    fetchUnix("/workers").pipe(
      Effect.flatMap(res => decodeJsonBody(res, Schema.Array(WorkerFiberState))),
    ),

  shutdown: () =>
    fetchUnix("/shutdown", { method: "POST" }).pipe(
      Effect.flatMap(checkOkResponse),
    ),
})

export const OrchestratorClientLive = Effect.succeed(makeOrchestratorClient())
