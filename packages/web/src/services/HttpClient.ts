import { HttpClient, HttpClientRequest } from "@effect/platform"
import { Context, Effect, Layer, Schema } from "effect"

// -- Request/Response schemas ------------------------------------------------

export class Repository extends Schema.Class<Repository>("Repository")({
  id: Schema.Number,
  name: Schema.String,
  path: Schema.String,
  createdAt: Schema.Number,
}) {}

export class Worker extends Schema.Class<Worker>("Worker")({
  name: Schema.String,
  worktreePath: Schema.String,
  branch: Schema.String,
  prdPath: Schema.String,
  createdAt: Schema.Number,
}) {}

export class WorkerFiberState extends Schema.Class<WorkerFiberState>("WorkerFiberState")({
  name: Schema.String,
  status: Schema.Literal("running", "completed", "errored"),
  startedAt: Schema.Number,
  currentTask: Schema.optional(Schema.String),
  iterationCount: Schema.Number,
  error: Schema.optional(Schema.String),
}) {}

export class UserStory extends Schema.Class<UserStory>("UserStory")({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  acceptanceCriteria: Schema.Array(Schema.String),
  passes: Schema.Boolean,
  notes: Schema.String,
}) {}

export class Prd extends Schema.Class<Prd>("Prd")({
  project: Schema.Struct({ name: Schema.String, description: Schema.String }),
  userStories: Schema.Array(UserStory),
}) {}

export class WorkerDetail extends Schema.Class<WorkerDetail>("WorkerDetail")({
  state: WorkerFiberState,
  prd: Schema.Union(Prd, Schema.Null),
}) {}

const RepositoriesResponse = Schema.Array(Repository)
const WorkersResponse = Schema.Array(Worker)
const WorkerStatesResponse = Schema.Array(WorkerFiberState)

// -- Errors ------------------------------------------------------------------

export class HttpClientError extends Schema.TaggedError<HttpClientError>()(
  "HttpClientError",
  {
    message: Schema.String,
    status: Schema.optional(Schema.Number),
  },
) {}

// -- Service interface -------------------------------------------------------

export interface HttpClientServiceInterface {
  readonly fetchRepositories: Effect.Effect<
    ReadonlyArray<Repository>,
    HttpClientError
  >
  readonly createRepository: (
    dir: string,
  ) => Effect.Effect<void, HttpClientError>
  readonly fetchWorkers: (
    repoName: string,
  ) => Effect.Effect<ReadonlyArray<Worker>, HttpClientError>
  readonly fetchWorkerState: (
    workerId: string,
  ) => Effect.Effect<WorkerFiberState, HttpClientError>
  readonly fetchWorkerDetail: (
    repoName: string,
    workerId: string,
  ) => Effect.Effect<WorkerDetail, HttpClientError>
  readonly createWorker: (
    repoName: string,
    workerName: string,
    planMessage: string,
  ) => Effect.Effect<void, HttpClientError>
  readonly stopWorker: (
    repoName: string,
    workerId: string,
  ) => Effect.Effect<void, HttpClientError>
  readonly fetchAllWorkerStates: Effect.Effect<
    ReadonlyArray<WorkerFiberState>,
    HttpClientError
  >
}

export class HttpClientService extends Context.Tag("HttpClientService")<
  HttpClientService,
  HttpClientServiceInterface
>() {}

// -- Helpers -----------------------------------------------------------------

const handleError = (error: unknown): HttpClientError =>
  error instanceof HttpClientError
    ? error
    : new HttpClientError({
        message: String(error),
        status: undefined,
      })

const jsonRequest = (
  client: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
) =>
  client.execute(request).pipe(
    Effect.flatMap((response) =>
      response.status === 200 || response.status === 201
        ? Effect.succeed(response)
        : response.json.pipe(
            Effect.flatMap((body) =>
              Effect.fail(
                new HttpClientError({
                  message:
                    (body as { error?: string }).error ?? "Request failed",
                  status: response.status,
                }),
              ),
            ),
          ),
    ),
    Effect.scoped,
  )

// -- HttpClientLive layer ----------------------------------------------------

export const HttpClientLive = Layer.effect(
  HttpClientService,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const baseUrl = "http://localhost:3001"

    return {
      fetchRepositories: jsonRequest(
        client,
        HttpClientRequest.get(`${baseUrl}/repositories`),
      ).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap((data) => Schema.decodeUnknown(RepositoriesResponse)(data)),
        Effect.mapError(handleError),
      ),

      createRepository: (dir) =>
        jsonRequest(
          client,
          HttpClientRequest.post(`${baseUrl}/repositories`).pipe(
            HttpClientRequest.setHeader("Content-Type", "application/json"),
            HttpClientRequest.bodyText(JSON.stringify({ dir })),
          ),
        ).pipe(
          Effect.asVoid,
          Effect.mapError(handleError),
        ),

      fetchWorkers: (repoName) =>
        jsonRequest(
          client,
          HttpClientRequest.get(
            `${baseUrl}/repositories/${encodeURIComponent(repoName)}/workers`,
          ),
        ).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap((data) => Schema.decodeUnknown(WorkersResponse)(data)),
          Effect.mapError(handleError),
        ),

      fetchWorkerState: (workerId) =>
        jsonRequest(
          client,
          HttpClientRequest.get(
            `${baseUrl}/workers/${encodeURIComponent(workerId)}`,
          ),
        ).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap((data) => Schema.decodeUnknown(WorkerFiberState)(data)),
          Effect.mapError(handleError),
        ),

      fetchWorkerDetail: (repoName, workerId) =>
        jsonRequest(
          client,
          HttpClientRequest.get(
            `${baseUrl}/repositories/${encodeURIComponent(repoName)}/workers/${encodeURIComponent(workerId)}`,
          ),
        ).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap((data) => Schema.decodeUnknown(WorkerDetail)(data)),
          Effect.mapError(handleError),
        ),

      createWorker: (repoName, workerName, planMessage) =>
        jsonRequest(
          client,
          HttpClientRequest.post(
            `${baseUrl}/repositories/${encodeURIComponent(repoName)}/workers`,
          ).pipe(
            HttpClientRequest.setHeader("Content-Type", "application/json"),
            HttpClientRequest.bodyText(
              JSON.stringify({ workerName, planMessage }),
            ),
          ),
        ).pipe(
          Effect.asVoid,
          Effect.mapError(handleError),
        ),

      stopWorker: (repoName, workerId) =>
        jsonRequest(
          client,
          HttpClientRequest.del(
            `${baseUrl}/repositories/${encodeURIComponent(repoName)}/workers/${encodeURIComponent(workerId)}`,
          ),
        ).pipe(
          Effect.asVoid,
          Effect.mapError(handleError),
        ),

      fetchAllWorkerStates: jsonRequest(
        client,
        HttpClientRequest.get(`${baseUrl}/workers`),
      ).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap((data) => Schema.decodeUnknown(WorkerStatesResponse)(data)),
        Effect.mapError(handleError),
      ),
    } satisfies HttpClientServiceInterface
  }),
)
