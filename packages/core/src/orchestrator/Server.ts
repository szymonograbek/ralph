import { HttpRouter, HttpServer, HttpServerResponse } from "@effect/platform"
import { Effect, Layer, Schema } from "effect"
import { OrchestratorTag, WorkerFiberState } from "./Orchestrator.ts"
import { extractErrorMessage } from "../extractErrorMessage.ts"

// -- Response schemas --------------------------------------------------------

const WorkerStatesResponse = Schema.Array(WorkerFiberState)

const encodeStates = Schema.encodeSync(WorkerStatesResponse)
const encodeState = Schema.encodeSync(WorkerFiberState)

// -- Helpers -----------------------------------------------------------------

const getParam = (params: Record<string, string | undefined>, key: string) =>
  Effect.gen(function* () {
    const value = params[key]
    if (value === undefined) {
      return yield* Effect.fail(new Error(`Missing path param: ${key}`))
    }
    return value
  })

const errorResponse = (err: unknown) =>
  HttpServerResponse.json({ error: extractErrorMessage(err) }, { status: 400 })

// -- Routes ------------------------------------------------------------------

const router = HttpRouter.empty.pipe(
  HttpRouter.get("/workers", Effect.gen(function* () {
    const orchestrator = yield* OrchestratorTag
    const states = yield* orchestrator.allWorkerStates
    return yield* HttpServerResponse.json(encodeStates(states))
  })),

  HttpRouter.get("/workers/:name", Effect.gen(function* () {
    const params = yield* HttpRouter.params
    const name = yield* getParam(params, "name")
    const orchestrator = yield* OrchestratorTag
    return yield* orchestrator.workerStatus(name).pipe(
      Effect.flatMap(state => HttpServerResponse.json(encodeState(state))),
      Effect.catchAll(err => errorResponse(err)),
    )
  })),

  HttpRouter.post("/workers/:name/start", Effect.gen(function* () {
    const params = yield* HttpRouter.params
    const name = yield* getParam(params, "name")
    const orchestrator = yield* OrchestratorTag
    return yield* orchestrator.startWorker(name).pipe(
      Effect.flatMap(() => HttpServerResponse.json({ ok: true })),
      Effect.catchAll(err => errorResponse(err)),
    )
  })),

  HttpRouter.post("/workers/:name/stop", Effect.gen(function* () {
    const params = yield* HttpRouter.params
    const name = yield* getParam(params, "name")
    const orchestrator = yield* OrchestratorTag
    return yield* orchestrator.stopWorker(name).pipe(
      Effect.flatMap(() => HttpServerResponse.json({ ok: true })),
      Effect.catchAll(err => errorResponse(err)),
    )
  })),

  HttpRouter.post("/shutdown", Effect.gen(function* () {
    const orchestrator = yield* OrchestratorTag
    // Completes ShutdownSignal Deferred → daemon unblocks → scope closes → cleanup
    // forkDaemon so the fiber outlives the request scope
    yield* Effect.forkDaemon(Effect.sleep("50 millis").pipe(
      Effect.andThen(orchestrator.shutdown),
    ))
    return yield* HttpServerResponse.json({ ok: true })
  })),
)

// -- Server layer ------------------------------------------------------------

export const OrchestratorServerLive = HttpServer.serve()(router)
