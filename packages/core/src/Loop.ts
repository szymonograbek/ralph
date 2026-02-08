import { Effect, Option } from "effect"
import { RalphConfig } from "./Config.ts"
import { readPrd, findNextIncomplete, allPass } from "./Prd.ts"
import { ProviderTag } from "./Provider.ts"
import { TerminalUITag } from "./TerminalUI.ts"

const iterate = (quiet: boolean) =>
  Effect.gen(function* () {
    const provider = yield* ProviderTag
    const ui = yield* TerminalUITag
    const prd = yield* readPrd

    const maybeTask = findNextIncomplete(prd)

    if (Option.isNone(maybeTask)) {
      yield* ui.updateMessage("All tasks complete.")
      return "complete" as const
    }

    const task = maybeTask.value
    const completed = prd.userStories.filter((s) => s.passes).length
    const total = prd.userStories.length

    yield* ui.setTask(task.title, completed, total)

    if (!quiet) {
      yield* ui.updateMessage(`Working on: ${task.title}`)
      yield* ui.render()
    }

    const prompt = provider.buildPrompt(task, prd)
    yield* provider.invoke(prompt, quiet)

    // Re-read PRD (provider may have updated it)
    const updatedPrd = yield* readPrd
    const taskNowPasses = updatedPrd.userStories.find((s) => s.id === task.id)?.passes

    if (taskNowPasses) {
      yield* ui.markTaskPassed()
    }

    if (allPass(updatedPrd)) {
      yield* ui.updateMessage("All tasks now pass.")
      return "complete" as const
    }

    return "continue" as const
  })

export const runLoop = (quiet: boolean) =>
  Effect.gen(function* () {
    const config = yield* RalphConfig
    const ui = yield* TerminalUITag

    for (let i = 0; i < config.maxIterations; i++) {
      const result = yield* iterate(quiet)
      if (result === "complete") {
        yield* ui.clear()
        return
      }
    }

    yield* ui.updateMessage(`Max iterations (${config.maxIterations}) reached.`)
    yield* ui.clear()
  })
