import { FileSystem, Path } from "@effect/platform"
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { Effect, Layer, Schema } from "effect"
import { OrchestratorTag, WorkerFiberState } from "./Orchestrator.ts"
import { Worker } from "../Worker.ts"
import { extractErrorMessage } from "../extractErrorMessage.ts"
import { Repository, Database } from "../Database.ts"
import { Prd } from "../Prd.ts"

// -- Response schemas --------------------------------------------------------

const WorkerStatesResponse = Schema.Array(WorkerFiberState)
const WorkersResponse = Schema.Array(Worker)
const RepositoriesResponse = Schema.Array(Repository)

const WorkerDetailResponse = Schema.Struct({
  state: WorkerFiberState,
  prd: Schema.Union(Prd, Schema.Null),
})

const encodeStates = Schema.encodeSync(WorkerStatesResponse)
const encodeState = Schema.encodeSync(WorkerFiberState)
const encodeWorkers = Schema.encodeSync(WorkersResponse)
const encodeRepositories = Schema.encodeSync(RepositoriesResponse)
const encodeWorkerDetail = Schema.encodeSync(WorkerDetailResponse)

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
  // Repository endpoints
  HttpRouter.get("/repositories", Effect.gen(function* () {
    const orchestrator = yield* OrchestratorTag
    return yield* orchestrator.listRepositories.pipe(
      Effect.flatMap(repos => HttpServerResponse.json(encodeRepositories(repos))),
      Effect.catchAll(err => errorResponse(err)),
    )
  })),

  HttpRouter.post("/repositories", Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const body = yield* request.json as unknown
    const dir = (body as { dir?: unknown }).dir
    if (typeof dir !== "string") {
      return yield* HttpServerResponse.json({ error: "Missing 'dir' field in request body" }, { status: 400 })
    }
    const orchestrator = yield* OrchestratorTag
    return yield* orchestrator.createRepository(dir).pipe(
      Effect.flatMap(() => HttpServerResponse.json({ ok: true })),
      Effect.catchAll(err => errorResponse(err)),
    )
  })),

  HttpRouter.get("/repositories/:name/workers", Effect.gen(function* () {
    const params = yield* HttpRouter.params
    const name = yield* getParam(params, "name")
    const orchestrator = yield* OrchestratorTag
    return yield* orchestrator.listWorkers(name).pipe(
      Effect.flatMap(workers => HttpServerResponse.json(encodeWorkers(workers))),
      Effect.catchAll(err => errorResponse(err)),
    )
  })),

  HttpRouter.post("/repositories/:name/workers", Effect.gen(function* () {
    const params = yield* HttpRouter.params
    const repoName = yield* getParam(params, "name")
    const request = yield* HttpServerRequest.HttpServerRequest
    const body = yield* request.json as unknown
    const workerName = (body as { workerName?: unknown }).workerName
    const planMessage = (body as { planMessage?: unknown }).planMessage

    if (typeof workerName !== "string" || !workerName.trim()) {
      return yield* HttpServerResponse.json({ error: "Missing 'workerName' field in request body" }, { status: 400 })
    }
    if (typeof planMessage !== "string" || !planMessage.trim()) {
      return yield* HttpServerResponse.json({ error: "Missing 'planMessage' field in request body" }, { status: 400 })
    }

    const orchestrator = yield* OrchestratorTag
    return yield* orchestrator.createAndStartWorker(repoName, workerName.trim(), planMessage.trim()).pipe(
      Effect.flatMap(() => HttpServerResponse.json({ ok: true })),
      Effect.catchAll(err => errorResponse(err)),
    )
  })),

  HttpRouter.del("/repositories/:name/workers/:id", Effect.gen(function* () {
    const params = yield* HttpRouter.params
    const name = yield* getParam(params, "name")
    const id = yield* getParam(params, "id")
    const orchestrator = yield* OrchestratorTag
    // id is the worker name in this context
    return yield* orchestrator.stopWorker(id).pipe(
      Effect.flatMap(() => HttpServerResponse.json({ ok: true })),
      Effect.catchAll(err => errorResponse(err)),
    )
  })),

  HttpRouter.get("/repositories/:name/workers/:id", Effect.gen(function* () {
    const params = yield* HttpRouter.params
    const id = yield* getParam(params, "id")
    const orchestrator = yield* OrchestratorTag
    const db = yield* Database
    const fs = yield* FileSystem.FileSystem

    // Get worker state
    const state = yield* orchestrator.workerStatus(id).pipe(
      Effect.catchAll(err => Effect.fail(err)),
    )

    // Get worker to read PRD
    const maybeWorker = yield* db.getWorker(id)
    if (!maybeWorker) {
      return yield* Effect.fail(new Error(`Worker not found: ${id}`))
    }

    // Read PRD.json from worker's prdPath
    const prd = yield* fs.readFileString(maybeWorker.prdPath).pipe(
      Effect.flatMap(content => Schema.decode(Prd)(JSON.parse(content))),
      Effect.catchAll(() => Effect.succeed(null)),
    )

    return yield* HttpServerResponse.json(encodeWorkerDetail({ state, prd }))
  })),

  // Original worker endpoints (kept for backward compatibility)
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
