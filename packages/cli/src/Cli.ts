import { Args, Command, Options } from "@effect/cli"
import { FileSystem, Path } from "@effect/platform"
import { Console, Effect, Layer, Option } from "effect"
import { RalphConfig, RalphConfigLive, ProviderLive, ProviderTag, TerminalUILive, runLoop, linkSkills, loadRegistry, saveRegistry, Worker, WorkerRegistry, readPrd, makeOrchestratorClient, daemonize, isDaemonChild, runDaemon, homeDir } from "@ralph/core"

const dir = Options.text("dir").pipe(Options.optional)
const config = Options.text("config").pipe(Options.optional)
const quiet = Options.boolean("quiet").pipe(Options.withAlias("q"))
const workerFlag = Options.text("worker").pipe(Options.optional)

const ralph = Command.make(
  "ralph",
  { dir, config, quiet, workerFlag },
  () => Console.log("Use 'ralph plan <message>' or 'ralph continue'. See --help."),
).pipe(
  Command.withDescription(
    "Autonomous Claude coding loop. Workflow: create worker → worker <name> → plan/continue → push"
  )
)

const getWorkerContext = Effect.succeed(process.env.RALPH_WORKER ?? null)

const resolveWorkerConfig = (workerName: string) =>
  Effect.gen(function* () {
    const registry = yield* loadRegistry
    const worker = registry.workers.find(w => w.name === workerName)
    if (!worker) {
      return yield* Effect.fail(new Error(`Worker '${workerName}' not found`))
    }
    const pathService = yield* Path.Path
    return {
      cwd: worker.worktreePath,
      dir: pathService.join(worker.worktreePath, ".ralph"),
    }
  })

const resolveParent = Effect.gen(function* () {
  const parent = yield* ralph

  // Check for worker context: --worker flag or env var
  const workerFromFlag = Option.getOrUndefined(parent.workerFlag)
  const workerFromContext = workerFromFlag ? null : (yield* getWorkerContext)
  const workerName = workerFromFlag ?? workerFromContext

  let configOverrides = {
    dir: Option.getOrUndefined(parent.dir),
    config: Option.getOrUndefined(parent.config),
  }

  // If worker context, resolve and change cwd
  if (workerName) {
    const workerConfig = yield* resolveWorkerConfig(workerName)
    process.chdir(workerConfig.cwd)
    configOverrides = {
      dir: workerConfig.dir,
      config: Option.getOrUndefined(parent.config),
    }
  }

  const configLayer = RalphConfigLive(configOverrides)
  const uiLayer = TerminalUILive(parent.quiet)
  const providerLayer = Layer.provide(ProviderLive, Layer.merge(configLayer, uiLayer))
  const layer = Layer.merge(Layer.merge(configLayer, providerLayer), uiLayer)

  return { layer, workerName } as const
})

const configFromParent = resolveParent.pipe(Effect.map(({ layer }) => layer))

const message = Args.text({ name: "message" })
const interactive = Options.boolean("interactive").pipe(Options.withAlias("i"))

const plan = Command.make("plan", { message, interactive }, ({ message, interactive }) =>
  Effect.gen(function* () {
    const parent = yield* ralph
    const layer = yield* configFromParent
    yield* Effect.provide(
      Effect.gen(function* () {
        const cfg = yield* RalphConfig
        const fs = yield* FileSystem.FileSystem
        const pathService = yield* Path.Path
        const prdPath = pathService.join(cfg.dir, "PRD.json")

        // Remove existing PRD if present
        yield* Effect.ignore(fs.remove(prdPath))

        yield* Console.log(`Planning in ${cfg.dir}...`)
        const provider = yield* ProviderTag
        yield* provider.invokePlan(message, interactive, parent.quiet)
        if (!interactive) {
          yield* Console.log("PRD generation complete")
        }
      }),
      layer,
    )
  }),
).pipe(
  Command.withDescription(
    "Generate PRD.json from prompt. Ex: ralph plan 'add user auth'"
  )
)

const continueCmd = Command.make("continue", {}, () =>
  Effect.gen(function* () {
    const parent = yield* ralph
    const layer = yield* configFromParent
    yield* Effect.provide(runLoop(parent.quiet), layer)
  }),
).pipe(
  Command.withDescription(
    "Run iteration loop against PRD.json. Picks incomplete tasks, invokes claude, checks completion"
  )
)

const linkSkillsCmd = Command.make("link-skills", {}, () => linkSkills)

const list = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const registry = yield* loadRegistry

    if (registry.workers.length === 0) {
      yield* Console.log("No workers")
      return
    }

    // Header
    yield* Console.log("")
    yield* Console.log("NAME           BRANCH                WORKTREE PATH                          CREATED")
    yield* Console.log("─".repeat(100))

    // Rows
    for (const worker of registry.workers) {
      const created = new Date(worker.createdAt).toISOString().split('T')[0]
      const name = worker.name.padEnd(14)
      const branch = worker.branch.padEnd(21)
      const path = worker.worktreePath.padEnd(38)
      yield* Console.log(`${name} ${branch} ${path} ${created}`)
    }

    yield* Console.log("")
  }),
).pipe(
  Command.withDescription(
    "List all workers with worktree paths, branches, creation dates"
  )
)

const sanitizeBranchName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

const workerName = Args.text({ name: "name" })

const runGitCommand = (args: string[]) =>
  Effect.async<string, Error>((resume) => {
    const proc = Bun.spawn(["git", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    })

    proc.exited.then(async (exitCode) => {
      if (exitCode === 0) {
        const stdout = await new Response(proc.stdout).text()
        resume(Effect.succeed(stdout))
      } else {
        const stderr = await new Response(proc.stderr).text()
        resume(Effect.fail(new Error(stderr || `git ${args[0]} failed with exit code ${exitCode}`)))
      }
    })
  })

const configFromParentNoWorker = Effect.gen(function* () {
  const parent = yield* ralph
  const configLayer = RalphConfigLive({
    dir: Option.getOrUndefined(parent.dir),
    config: Option.getOrUndefined(parent.config),
  })
  const uiLayer = TerminalUILive(parent.quiet)
  const providerLayer = Layer.provide(ProviderLive, Layer.merge(configLayer, uiLayer))
  return Layer.merge(Layer.merge(configLayer, providerLayer), uiLayer)
})

const create = Command.make("create", { workerName }, ({ workerName }) =>
  Effect.gen(function* () {
    const layer = yield* configFromParentNoWorker

    yield* Effect.provide(
      Effect.gen(function* () {
        const cfg = yield* RalphConfig
        const fs = yield* FileSystem.FileSystem
        const pathService = yield* Path.Path

        // Check git repo exists
        yield* runGitCommand(["rev-parse", "--git-dir"]).pipe(
          Effect.catchAll(() => Effect.fail(new Error("Not a git repository"))),
        )

        // Load registry and check uniqueness
        const registry = yield* loadRegistry
        const exists = registry.workers.some(w => w.name === workerName)
        if (exists) {
          return yield* Effect.fail(new Error(`Worker '${workerName}' already exists`))
        }

        // Get repo name
        const repoRoot = yield* runGitCommand(["rev-parse", "--show-toplevel"])
        const repoName = pathService.basename(repoRoot.trim())

        // Get current HEAD commit
        const headCommit = yield* runGitCommand(["rev-parse", "HEAD"])

        // Determine branch name from PRD or default
        let branchName = `${cfg.defaultBranchPrefix}-${workerName}`
        const prdPath = pathService.join(cfg.dir, "PRD.json")
        const prdExists = yield* fs.exists(prdPath)

        if (prdExists) {
          const prd = yield* readPrd.pipe(Effect.catchAll(() => Effect.succeed(null)))
          if (prd) {
            branchName = sanitizeBranchName(prd.project.name)
          }
        }

        // Create worktree directory path
        const worktreesDir = cfg.worktreeBasePath ?? pathService.join(homeDir, ".ralph", "worktrees")
        const worktreePath = pathService.join(worktreesDir, `${repoName}-${workerName}`)

        // Ensure worktrees directory exists
        yield* fs.makeDirectory(worktreesDir, { recursive: true }).pipe(
          Effect.catchAll(() => Effect.void),
        )

        // Create worktree with new branch
        yield* runGitCommand([
          "worktree", "add", "-b", branchName, worktreePath, headCommit.trim()
        ]).pipe(
          Effect.catchAll((err) => Effect.fail(new Error(`Failed to create worktree: ${err.message}`))),
        )

        // Create .ralph directory in worktree
        const ralphDir = pathService.join(worktreePath, ".ralph")
        yield* fs.makeDirectory(ralphDir, { recursive: true })

        // Create worker and save to registry
        const worker = new Worker({
          name: workerName,
          worktreePath,
          branch: branchName,
          prdPath: pathService.join(ralphDir, "PRD.json"),
          createdAt: Date.now(),
        })

        const updatedRegistry = new WorkerRegistry({
          workers: [...registry.workers, worker],
        })

        yield* saveRegistry(updatedRegistry)

        yield* Console.log(`Created worker '${workerName}'`)
        yield* Console.log(`  Worktree: ${worktreePath}`)
        yield* Console.log(`  Branch: ${branchName}`)
      }),
      layer,
    )
  }),
).pipe(
  Command.withDescription(
    "Create git worktree + branch for isolated work. Ex: ralph create feature-x"
  )
)

const confirmInput = (prompt: string) =>
  Effect.async<boolean, never>((resume) => {
    process.stdout.write(prompt)
    process.stdin.once("data", (data) => {
      const answer = data.toString().trim().toLowerCase()
      resume(Effect.succeed(answer === "y" || answer === "yes"))
    })
  })

const deleteCmd = Command.make("delete", { workerName }, ({ workerName }) =>
  Effect.gen(function* () {
    const client = makeOrchestratorClient()

    // Load registry and find worker
    const registry = yield* loadRegistry
    const worker = registry.workers.find(w => w.name === workerName)

    if (!worker) {
      return yield* Effect.fail(new Error(`Worker '${workerName}' not found`))
    }

    // Stop via orchestrator if running
    yield* Console.log("Stopping worker...")
    yield* client.stopWorker(workerName).pipe(
      Effect.catchAll(() => Console.log("  Worker not running in orchestrator")),
    )

    // Remove worktree (graceful if already gone)
    yield* Console.log(`Removing worktree: ${worker.worktreePath}`)
    yield* runGitCommand(["worktree", "remove", worker.worktreePath]).pipe(
      Effect.catchAll((err) => {
        if (err.message.includes("not a working tree") || err.message.includes("does not exist")) {
          return Console.log("  Worktree already removed")
        }
        return Effect.fail(err)
      }),
    )

    // Ask to delete branch
    const shouldDeleteBranch = yield* confirmInput(`Delete branch '${worker.branch}'? (y/n): `).pipe(
      Effect.tap(() => Console.log(""))
    )

    if (shouldDeleteBranch) {
      yield* runGitCommand(["branch", "-D", worker.branch]).pipe(
        Effect.catchAll((err) => Console.log(`  Branch deletion failed: ${err.message}`)),
        Effect.tap(() => Console.log(`  Deleted branch '${worker.branch}'`)),
      )
    }

    // Remove from registry
    const updatedRegistry = new WorkerRegistry({
      workers: registry.workers.filter(w => w.name !== workerName),
    })

    yield* saveRegistry(updatedRegistry)
    yield* Console.log(`Worker '${workerName}' removed`)
  }),
).pipe(
  Command.withDescription(
    "Remove worker: deletes worktree, prompts for branch deletion, removes from registry"
  )
)

const workerCmd = Command.make("worker", { workerName }, ({ workerName }) =>
  Effect.gen(function* () {
    // Load registry and validate worker exists
    const registry = yield* loadRegistry
    const worker = registry.workers.find(w => w.name === workerName)

    if (!worker) {
      return yield* Effect.fail(new Error(`Worker '${workerName}' not found`))
    }

    // Print export command for eval — scoped to current terminal session
    yield* Console.log(`export RALPH_WORKER=${workerName}`)
  }),
).pipe(
  Command.withDescription(
    "Set worker context for current shell. Usage: eval $(ralph worker <name>)"
  )
)

const textInput = (prompt: string) =>
  Effect.async<string, never>((resume) => {
    process.stdout.write(prompt)
    process.stdin.once("data", (data) => {
      const input = data.toString().trim()
      resume(Effect.succeed(input))
    })
  })

const push = Command.make("push", {}, () =>
  Effect.gen(function* () {
    const { layer, workerName } = yield* resolveParent

    if (!workerName) {
      return yield* Effect.fail(new Error("Not in worker context. Use 'ralph worker <name>' or --worker flag"))
    }

    yield* Effect.provide(
      Effect.gen(function* () {
        const cfg = yield* RalphConfig

        // Get current branch
        const currentBranch = yield* runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"]).pipe(
          Effect.map(s => s.trim()),
          Effect.catchAll((err) => Effect.fail(new Error(`Failed to get current branch: ${err.message}`))),
        )

        // Check protected branches from config
        if (cfg.protectedBranches.includes(currentBranch)) {
          return yield* Effect.fail(new Error(`Cannot push protected branch '${currentBranch}'`))
        }

        // Show current branch and prompt
        yield* Console.log(`Current branch: ${currentBranch}`)
        const choice = yield* textInput("Push? (y/n/r to rename): ")

        if (choice === "n" || choice === "no") {
          yield* Console.log("Push cancelled")
          return
        }

        let branchToPush = currentBranch

        if (choice === "r" || choice === "rename") {
          // Rename flow
          const newBranchName = yield* textInput("New branch name: ")

          if (!newBranchName) {
            return yield* Effect.fail(new Error("Branch name cannot be empty"))
          }

          // Check if new name is protected
          if (cfg.protectedBranches.includes(newBranchName)) {
            return yield* Effect.fail(new Error(`Cannot rename to protected branch '${newBranchName}'`))
          }

          // Rename branch
          yield* runGitCommand(["branch", "-m", newBranchName]).pipe(
            Effect.catchAll((err) => Effect.fail(new Error(`Branch rename failed: ${err.message}`))),
          )

          yield* Console.log(`Branch renamed: ${currentBranch} → ${newBranchName}`)
          branchToPush = newBranchName

          // Update worker registry with new branch name
          const registry = yield* loadRegistry
          const updatedWorkers = registry.workers.map(w =>
            w.name === workerName
              ? new Worker({ ...w, branch: newBranchName })
              : w
          )
          yield* saveRegistry(new WorkerRegistry({ workers: updatedWorkers }))
        } else if (choice !== "y" && choice !== "yes") {
          yield* Console.log("Push cancelled")
          return
        }

        // Push with upstream tracking
        yield* Console.log(`Pushing ${branchToPush}...`)
        yield* runGitCommand(["push", "-u", "origin", branchToPush]).pipe(
          Effect.catchAll((err) => {
            const msg = err.message
            if (msg.includes("authentication") || msg.includes("Permission denied")) {
              return Effect.fail(new Error("Push failed: authentication error"))
            }
            if (msg.includes("rejected")) {
              return Effect.fail(new Error("Push rejected: remote has changes. Pull first or use force push"))
            }
            if (msg.includes("Could not resolve host") || msg.includes("network")) {
              return Effect.fail(new Error("Push failed: network error"))
            }
            return Effect.fail(new Error(`Push failed: ${msg}`))
          }),
        )

        yield* Console.log(`Successfully pushed ${branchToPush}`)
      }),
      layer,
    )
  }),
).pipe(
  Command.withDescription(
    "Push worker branch to remote. Checks protected branches, optional rename. Ex: ralph push"
  )
)

// -- Orchestrator commands ---------------------------------------------------

const orchestrateSubName = Args.text({ name: "action" }).pipe(Args.optional)

const orchestrate = Command.make("orchestrate", { orchestrateSubName }, ({ orchestrateSubName }) =>
  Effect.gen(function* () {
    const action = Option.getOrUndefined(orchestrateSubName)
    const client = makeOrchestratorClient()

    if (action === "stop") {
      // Send shutdown to running daemon
      yield* client.shutdown().pipe(
        Effect.tap(() => Console.log("Orchestrator stopped")),
        Effect.catchAll(err => Console.error(`Failed to stop orchestrator: ${err.message}`)),
      )
      return
    }

    // Check if already running
    const running = yield* client.isRunning()
    if (running) {
      yield* Console.log("Orchestrator already running")
      return
    }

    // Handle daemon child mode
    if (isDaemonChild()) {
      yield* runDaemon
      return
    }

    // Fork daemon
    const pid = yield* daemonize()
    yield* Console.log(`Orchestrator started (PID ${pid})`)
  }),
).pipe(
  Command.withDescription(
    "Start orchestrator daemon. 'ralph orchestrate stop' to shut down"
  )
)

const start = Command.make("start", { workerName }, ({ workerName }) =>
  Effect.gen(function* () {
    // Load registry and validate worker exists
    const registry = yield* loadRegistry
    const worker = registry.workers.find(w => w.name === workerName)

    if (!worker) {
      return yield* Effect.fail(new Error(`Worker '${workerName}' not found`))
    }

    const client = makeOrchestratorClient()

    // Check orchestrator is running
    const running = yield* client.isRunning()
    if (!running) {
      return yield* Effect.fail(new Error("Orchestrator not running. Start with 'ralph orchestrate'"))
    }

    yield* client.startWorker(workerName)
    yield* Console.log(`Started worker ${workerName}`)
  }),
).pipe(
  Command.withDescription(
    "Start worker in orchestrator. Ex: ralph start feature-x"
  )
)

const stop = Command.make("stop", { workerName }, ({ workerName }) =>
  Effect.gen(function* () {
    // Load registry and validate worker exists
    const registry = yield* loadRegistry
    const worker = registry.workers.find(w => w.name === workerName)

    if (!worker) {
      return yield* Effect.fail(new Error(`Worker '${workerName}' not found`))
    }

    const client = makeOrchestratorClient()
    yield* client.stopWorker(workerName)
    yield* Console.log(`Stopped worker ${workerName}`)
  }),
).pipe(
  Command.withDescription(
    "Stop worker in orchestrator. Ex: ralph stop feature-x"
  )
)

const formatUptime = (ms: number): string => {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

const status = Command.make("status", { workerName }, ({ workerName }) =>
  Effect.gen(function* () {
    // Load registry and validate worker exists
    const registry = yield* loadRegistry
    const worker = registry.workers.find(w => w.name === workerName)

    if (!worker) {
      return yield* Effect.fail(new Error(`Worker '${workerName}' not found`))
    }

    const client = makeOrchestratorClient()
    const running = yield* client.isRunning()
    if (!running) {
      yield* Console.log(`Orchestrator not running`)
      return
    }

    const state = yield* client.workerStatus(workerName).pipe(
      Effect.catchAll(() => Effect.succeed(null)),
    )

    if (!state || state.status !== "running") {
      yield* Console.log(`Worker ${workerName} is not running`)
      if (state?.error) {
        yield* Console.log(`  Last error: ${state.error}`)
      }
      return
    }

    const now = Date.now()
    const uptimeMs = now - state.startedAt

    yield* Console.log(`Worker ${workerName} is running`)
    yield* Console.log(`  Branch: ${worker.branch}`)
    yield* Console.log(`  Worktree: ${worker.worktreePath}`)
    yield* Console.log(`  Uptime: ${formatUptime(uptimeMs)}`)
    yield* Console.log(`  Iterations: ${state.iterationCount}`)

    if (state.currentTask) {
      yield* Console.log(`  Current task: ${state.currentTask}`)
    }

    // Read PRD for progress
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const prdPath = pathService.join(worker.worktreePath, ".ralph", "PRD.json")
    const prdContent = yield* fs.readFileString(prdPath).pipe(
      Effect.catchAll(() => Effect.succeed(null))
    )

    if (prdContent) {
      const prdJson = JSON.parse(prdContent) as { userStories?: Array<{ passes: boolean }> }
      if (prdJson.userStories) {
        const completed = prdJson.userStories.filter(s => s.passes).length
        const total = prdJson.userStories.length
        yield* Console.log(`  Progress: ${completed}/${total} tasks completed`)
      }
    }
  }),
).pipe(
  Command.withDescription(
    "Show worker status with progress. Ex: ralph status feature-x"
  )
)

const state = Command.make("state", {}, () =>
  Effect.gen(function* () {
    const registry = yield* loadRegistry

    if (registry.workers.length === 0) {
      yield* Console.log("No workers")
      return
    }

    // Try to get orchestrator states
    const client = makeOrchestratorClient()
    const running = yield* client.isRunning()
    const orchestratorStates = running
      ? yield* client.allWorkerStates().pipe(
          Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<{ name: string; status: string; startedAt: number; currentTask?: string | undefined; iterationCount: number; error?: string | undefined }>)),
        )
      : []

    const stateMap = new Map(orchestratorStates.map(s => [s.name, s]))

    // Header
    yield* Console.log("")
    yield* Console.log("NAME           STATUS         ITERATIONS   CURRENT_TASK")
    yield* Console.log("─".repeat(80))

    // Rows
    for (const worker of registry.workers) {
      const fiberState = stateMap.get(worker.name)
      const name = worker.name.padEnd(14)

      const workerStatus = fiberState?.status ?? "stopped"
      const statusStr = workerStatus.padEnd(14)

      const iterations = fiberState ? String(fiberState.iterationCount).padEnd(12) : "─".padEnd(12)

      let currentTask = "─"
      if (fiberState?.currentTask) {
        currentTask = fiberState.currentTask
      } else if (fiberState?.status === "errored" && fiberState.error) {
        currentTask = `Error: ${fiberState.error.slice(0, 40)}`
      }

      yield* Console.log(`${name} ${statusStr} ${iterations} ${currentTask}`)
    }

    yield* Console.log("")
  }),
).pipe(
  Command.withDescription(
    "List all workers with status and current tasks"
  )
)

const logs = Command.make("logs", { workerName }, ({ workerName }) =>
  Effect.gen(function* () {
    const logPath = `${homeDir}/.ralph/logs/${workerName}.log`
    const fs = yield* FileSystem.FileSystem

    const exists = yield* fs.exists(logPath)
    if (!exists) {
      yield* Console.log(`No log file for worker '${workerName}'`)
      return
    }

    const content = yield* fs.readFileString(logPath)
    // Show last 50 lines
    const lines = content.split("\n")
    const tail = lines.slice(-50).join("\n")
    yield* Console.log(tail)
  }),
).pipe(
  Command.withDescription(
    "Show recent worker logs. Ex: ralph logs feature-x"
  )
)

export const command = ralph.pipe(Command.withSubcommands([plan, continueCmd, linkSkillsCmd, list, create, deleteCmd, workerCmd, push, orchestrate, start, stop, status, state, logs]))

export const cli = Command.run(command, {
  name: "ralph",
  version: "0.0.1",
})
