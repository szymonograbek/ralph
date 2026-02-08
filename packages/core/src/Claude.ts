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
    "After completing the task, update PRD.json: set passes to true. Update notes with anything useful for future iterations — implementation details, architectural decisions, context, dependencies, gotchas.",
  ].join("\n")

export { buildPrompt }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null

const parseJson = (s: string): unknown => {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

const logStreamEvent = (line: string): void => {
  const event = parseJson(line)
  if (!isRecord(event)) return

  if (event.type === "assistant" && isRecord(event.message)) {
    const content = event.message.content
    if (!Array.isArray(content)) return
    for (const block of content) {
      if (!isRecord(block)) continue
      if (block.type === "text" && typeof block.text === "string") {
        console.log(block.text)
      }
      if (block.type === "tool_use" && typeof block.name === "string") {
        console.log(`  ▸ ${block.name}`)
      }
    }
  }

  if (event.type === "result" && typeof event.duration_ms === "number") {
    const secs = (event.duration_ms / 1000).toFixed(1)
    const cost = typeof event.total_cost_usd === "number"
      ? ` · $${event.total_cost_usd.toFixed(4)}`
      : ""
    console.log(`Done (${secs}s${cost})`)
  }
}

const claudeArgs = (prompt: string): ReadonlyArray<string> => [
  "-p",
  prompt,
  "--dangerously-skip-permissions",
  "--output-format",
  "stream-json",
  "--verbose",
]

const spawnClaude = (prompt: string, quiet: boolean): Promise<string> =>
  new Promise((resolve, reject) => {
    const proc = Bun.spawn(["claude", ...claudeArgs(prompt)], {
      stdout: "pipe",
      stderr: quiet ? "pipe" : "inherit",
    })

    const chunks: Array<string> = []
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()

    const read = (): void => {
      reader.read().then(({ done, value }) => {
        if (done) {
          resolve(chunks.join(""))
          return
        }
        const text = decoder.decode(value)
        chunks.push(text)
        if (!quiet) {
          for (const line of text.split("\n")) {
            if (line.trim()) logStreamEvent(line)
          }
        }
        read()
      }, reject)
    }

    read()
  })

export const invokeClaude = (prompt: string, quiet: boolean) =>
  Effect.promise(() => spawnClaude(prompt, quiet))

export const invokeClaudePlan = (message: string, interactive: boolean, quiet: boolean) => {
  const prompt = `Use the generate-prd skill\n\n${message}`

  if (interactive) {
    const cmd = Command.make("claude", prompt)
    return Command.exitCode(
      cmd.pipe(Command.stdin("inherit"), Command.stdout("inherit"), Command.stderr("inherit")),
    )
  }

  return invokeClaude(prompt, quiet).pipe(Effect.as(0))
}
