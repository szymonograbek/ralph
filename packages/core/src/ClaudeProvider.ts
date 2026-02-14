import { Effect, Layer } from "effect"
import { ProviderTag, type Provider, type ProviderResponse } from "./Provider.ts"
import type { UserStory, Prd } from "./Prd.ts"
import type { TerminalUI } from "./TerminalUI.ts"
import { TerminalUITag } from "./TerminalUI.ts"
import { prdSystemPrompt } from "./prompts/prd.ts"

// -- Prompt ------------------------------------------------------------------

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

// -- Stream parsing ----------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null

const parseJson = (s: string): unknown => {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

const processStreamEvent = (line: string, ui: TerminalUI): Effect.Effect<void> => {
  const event = parseJson(line)
  if (!isRecord(event)) return Effect.void

  if (event.type === "assistant" && isRecord(event.message)) {
    const content = event.message.content
    if (!Array.isArray(content)) return Effect.void

    return Effect.gen(function* () {
      for (const block of content) {
        if (!isRecord(block)) continue
        if (block.type === "text" && typeof block.text === "string") {
          yield* ui.updateMessage(block.text)
        }
        if (block.type === "tool_use" && typeof block.name === "string") {
          yield* ui.updateMessage(`▸ ${block.name}`)
        }
      }
    })
  }

  if (event.type === "result" && typeof event.duration_ms === "number") {
    const secs = (event.duration_ms / 1000).toFixed(1)
    const cost =
      typeof event.total_cost_usd === "number"
        ? ` · $${event.total_cost_usd.toFixed(4)}`
        : ""
    return ui.updateMessage(`Done (${secs}s${cost})`)
  }

  return Effect.void
}

// -- Process spawning --------------------------------------------------------

const claudeArgs = (prompt: string): ReadonlyArray<string> => [
  "-p",
  prompt,
  "--dangerously-skip-permissions",
  "--output-format",
  "stream-json",
  "--verbose",
]

const spawnClaude = (prompt: string, quiet: boolean, ui: TerminalUI): Effect.Effect<string> =>
  Effect.gen(function* () {
    const proc = Bun.spawn(["claude", ...claudeArgs(prompt)], {
      stdout: "pipe",
      stderr: quiet ? "pipe" : "inherit",
    })

    const chunks: Array<string> = []
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const result = yield* Effect.promise(() => reader.read())
      if (result.done) break

      const text = decoder.decode(result.value)
      chunks.push(text)

      if (!quiet) {
        for (const line of text.split("\n")) {
          if (line.trim()) {
            yield* processStreamEvent(line, ui)
          }
        }
        yield* ui.render()
      }
    }

    return chunks.join("")
  })

const spawnClaudePlan = (prompt: string, quiet: boolean, interactive: boolean): Effect.Effect<number> =>
  Effect.promise(() => {
    const args = interactive
      ? [prompt]
      : ["-p", prompt, "--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose"]
    const proc = Bun.spawn(["claude", ...args], {
      stdout: interactive ? "inherit" : "pipe",
      stderr: quiet && !interactive ? "pipe" : "inherit",
      stdin: interactive ? "inherit" : undefined,
    })
    return proc.exited
  })

// -- Response parsing --------------------------------------------------------

const parseResponse = (output: string): ProviderResponse => ({
  raw: output,
  containsMarker: (marker: string) => output.includes(marker),
})

// -- Provider factory (captures TerminalUI at construction) ------------------

const makeClaudeProvider = (ui: TerminalUI): Provider => ({
  buildPrompt,
  invoke: (prompt, quiet) => spawnClaude(prompt, quiet, ui),
  parseResponse,
  invokePlan: (message, interactive, quiet) => {
    const prompt = interactive
      ? `${prdSystemPrompt}\n\n---\n\nUser request:\n${message}`
      : `${prdSystemPrompt}\n\nIMPORTANT: Do NOT ask clarifying questions. Use your best judgment and generate the PRD immediately.\n\n---\n\nUser request:\n${message}`

    return spawnClaudePlan(prompt, quiet, interactive)
  },
})

export const ClaudeProviderLive = Layer.effect(
  ProviderTag,
  Effect.gen(function* () {
    const ui = yield* TerminalUITag
    return makeClaudeProvider(ui)
  }),
)
