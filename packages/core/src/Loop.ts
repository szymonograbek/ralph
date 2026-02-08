import { Console, Effect, Option } from "effect"
import { RalphConfig } from "./Config.ts"
import { readPrd, findNextIncomplete, allPass } from "./Prd.ts"
import { ProviderTag } from "./Provider.ts"

const iterate = (quiet: boolean) =>
  Effect.gen(function* () {
    const provider = yield* ProviderTag
    const prd = yield* readPrd

    const maybeTask = findNextIncomplete(prd)

    if (Option.isNone(maybeTask)) {
      yield* Console.log("All tasks complete.")
      return "complete" as const
    }

    const task = maybeTask.value
    const completed = prd.userStories.filter((s) => s.passes).length
    const total = prd.userStories.length

    if (!quiet) {
      yield* Console.log(`[${completed}/${total}] Working on: ${task.title}`)
    }

    const prompt = provider.buildPrompt(task, prd)
    yield* provider.invoke(prompt, quiet)

    // Re-read PRD (provider may have updated it)
    const updatedPrd = yield* readPrd

    if (allPass(updatedPrd)) {
      yield* Console.log("All tasks now pass.")
      return "complete" as const
    }

    return "continue" as const
  })

export const runLoop = (quiet: boolean) =>
  Effect.gen(function* () {
    const config = yield* RalphConfig

    for (let i = 0; i < config.maxIterations; i++) {
      const result = yield* iterate(quiet)
      if (result === "complete") return
    }

    yield* Console.log(`Max iterations (${config.maxIterations}) reached.`)
  })
