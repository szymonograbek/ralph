import { Args, Command, Options } from "@effect/cli"
import { Console, Effect, Layer, Option } from "effect"
import { RalphConfig, RalphConfigLive, ProviderLive, TerminalUILive, invokeClaudePlan, runLoop, linkSkills } from "@ralph/core"

const dir = Options.text("dir").pipe(Options.optional)
const config = Options.text("config").pipe(Options.optional)
const quiet = Options.boolean("quiet").pipe(Options.withAlias("q"))

const ralph = Command.make("ralph", { dir, config, quiet }, () =>
  Console.log("Use 'ralph plan <message>' or 'ralph continue'. See --help."),
)

const configFromParent = Effect.gen(function* () {
  const parent = yield* ralph
  const configLayer = RalphConfigLive({
    dir: Option.getOrUndefined(parent.dir),
    config: Option.getOrUndefined(parent.config),
  })
  return Layer.merge(
    Layer.merge(configLayer, Layer.provide(ProviderLive, configLayer)),
    TerminalUILive(parent.quiet),
  )
})

const message = Args.text({ name: "message" })

const plan = Command.make("plan", { message }, ({ message }) =>
  Effect.gen(function* () {
    const layer = yield* configFromParent
    yield* Effect.provide(
      Effect.gen(function* () {
        const cfg = yield* RalphConfig
        yield* Console.log(`Planning in ${cfg.dir}...`)
        yield* invokeClaudePlan(message)
      }),
      layer,
    )
  }),
)

const continueCmd = Command.make("continue", {}, () =>
  Effect.gen(function* () {
    const parent = yield* ralph
    const layer = yield* configFromParent
    yield* Effect.provide(runLoop(parent.quiet), layer)
  }),
)

const linkSkillsCmd = Command.make("link-skills", {}, () => linkSkills)

export const command = ralph.pipe(Command.withSubcommands([plan, continueCmd, linkSkillsCmd]))

export const cli = Command.run(command, {
  name: "ralph",
  version: "0.0.1",
})
