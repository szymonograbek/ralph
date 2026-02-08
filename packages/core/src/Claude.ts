import { Command } from "@effect/platform"
import { Effect } from "effect"
import type { UserStory, Prd } from "./Prd.ts"

const buildPrompt = (task: UserStory, prd: Prd): string =>
  [
    `Project: ${prd.project.name} — ${prd.project.description}`,
    "",
    `Current task: ${task.title} (${task.id})`,
    task.description,
    "",
    "Acceptance Criteria:",
    ...task.acceptanceCriteria.map((c) => `- ${c}`),
    "",
    task.notes ? `Notes from previous iterations:\n${task.notes}` : "",
    "",
    "After completing the task, update PRD.json: set passes to true. Only update notes with important architectural decisions or difficulties encountered — leave notes empty if none.",
  ].join("\n")

export { buildPrompt }

export const invokeClaude = (prompt: string, quiet: boolean) => {
  const cmd = Command.make("claude", "-p", prompt, "--output-format", "stream-json")
  if (quiet) {
    return Command.string(cmd)
  }
  return Command.exitCode(cmd.pipe(Command.stdout("inherit"), Command.stderr("inherit"))).pipe(
    Effect.map(() => ""),
  )
}

export const invokeClaudePlan = (message: string) => {
  const prompt = `Use the generate-prd skill\n\n${message}`
  const cmd = Command.make("claude", prompt)
  return Command.exitCode(
    cmd.pipe(Command.stdin("inherit"), Command.stdout("inherit"), Command.stderr("inherit")),
  )
}
