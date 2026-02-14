import { FileSystem } from "@effect/platform"
import { BunContext, BunHttpServer } from "@effect/platform-bun"
import { Deferred, Effect, Layer } from "effect"
import { OrchestratorLive, ShutdownSignal } from "./Orchestrator.ts"
import { OrchestratorServerLive } from "./Server.ts"
import { socketPath, pidFilePath } from "./paths.ts"
import { homeDir } from "../homeDir.ts"
import { DatabaseLive } from "../Database.ts"

// -- Socket/PID file helpers -------------------------------------------------

const cleanStaleSocket = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  const socketExists = yield* fs.exists(socketPath)
  if (!socketExists) return

  // Try connecting to detect if orchestrator is actually running
  const isAlive = yield* Effect.tryPromise({
    try: () => fetch("http://localhost/workers", {
      unix: socketPath,
    } as RequestInit).then(() => true),
    catch: () => false,
  })

  if (!isAlive) {
    yield* fs.remove(socketPath).pipe(Effect.catchAll(() => Effect.void))
    yield* fs.remove(pidFilePath).pipe(Effect.catchAll(() => Effect.void))
  }
})

const writePidFile = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  yield* fs.writeFileString(pidFilePath, String(process.pid))
})

const cleanupFiles = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  yield* fs.remove(socketPath).pipe(Effect.catchAll(() => Effect.void))
  yield* fs.remove(pidFilePath).pipe(Effect.catchAll(() => Effect.void))
})

// -- Log directory -----------------------------------------------------------

const ensureLogDir = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory(`${homeDir}/.ralph/logs`, { recursive: true }).pipe(
    Effect.catchAll(() => Effect.void),
  )
})

// -- Daemon entry point ------------------------------------------------------

export const runDaemon = Effect.gen(function* () {
  yield* cleanStaleSocket
  yield* ensureLogDir
  yield* writePidFile

  yield* Effect.addFinalizer(() => cleanupFiles)

  // Create shutdown signal Deferred
  const shutdownDeferred = yield* Deferred.make<void>()
  const shutdownLayer = Layer.succeed(ShutdownSignal, shutdownDeferred)

  const unixSocketLayer = BunHttpServer.layer({ unix: socketPath })
  const httpServerLayer = BunHttpServer.layer({ port: 3001 })

  const orchestratorWithDeps = Layer.provide(
    OrchestratorLive,
    Layer.merge(shutdownLayer, DatabaseLive),
  )

  // Unix socket server
  const unixServerLayer = Layer.provideMerge(
    OrchestratorServerLive,
    Layer.merge(
      Layer.merge(unixSocketLayer, orchestratorWithDeps),
      BunContext.layer,
    ),
  )

  // HTTP server
  const httpServerFullLayer = Layer.provideMerge(
    OrchestratorServerLive,
    Layer.merge(
      Layer.merge(httpServerLayer, orchestratorWithDeps),
      BunContext.layer,
    ),
  )

  // Build both servers (starts both + orchestrator), then await shutdown signal
  yield* Effect.all([
    Effect.acquireRelease(Layer.build(unixServerLayer), () => Effect.void),
    Effect.acquireRelease(Layer.build(httpServerFullLayer), () => Effect.void),
  ])

  // Block until shutdown signal is completed
  yield* Deferred.await(shutdownDeferred)

  // Small delay to let HTTP response flush
  yield* Effect.sleep("100 millis")
}).pipe(Effect.scoped, Effect.provide(BunContext.layer))

// -- Daemonize (fork + detach) -----------------------------------------------

export const daemonize = (): Effect.Effect<number, Error> =>
  Effect.sync(() => {
    const proc = Bun.spawn(["bun", ...process.argv.slice(1), "--daemon-child"], {
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env, RALPH_DAEMON: "1" },
    })

    // Detach child — allow parent to exit
    proc.unref()

    return proc.pid
  })

export const isDaemonChild = () =>
  process.argv.includes("--daemon-child") || process.env.RALPH_DAEMON === "1"
