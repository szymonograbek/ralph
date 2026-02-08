import { Context, Effect, Layer, Ref } from "effect"

interface TerminalUIState {
  readonly taskName: string | null
  readonly current: number
  readonly total: number
  readonly latestMessage: string | null
  readonly spinnerActive: boolean
  readonly spinnerFrame: number
}

const initialState: TerminalUIState = {
  taskName: null,
  current: 0,
  total: 0,
  latestMessage: null,
  spinnerActive: false,
  spinnerFrame: 0,
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

const ANSI = {
  CLEAR_SCREEN: "\x1b[2J",
  MOVE_HOME: "\x1b[H",
  CLEAR_LINE: "\x1b[2K",
  HIDE_CURSOR: "\x1b[?25l",
  SHOW_CURSOR: "\x1b[?25h",
} as const

export interface TerminalUI {
  readonly setTask: (name: string, current: number, total: number) => Effect.Effect<void>
  readonly updateMessage: (text: string) => Effect.Effect<void>
  readonly markTaskPassed: () => Effect.Effect<void>
  readonly clear: () => Effect.Effect<void>
  readonly getState: () => Effect.Effect<TerminalUIState>
  readonly render: () => Effect.Effect<void>
}

export class TerminalUITag extends Context.Tag("TerminalUI")<TerminalUITag, TerminalUI>() {}

export const makeTerminalUI = (quiet: boolean) => Effect.gen(function* () {
  const stateRef = yield* Ref.make(initialState)

  const getTerminalWidth = (): number => {
    return process.stdout.columns || 80
  }

  const buildOutput = (state: TerminalUIState): string => {
    const width = getTerminalWidth()
    const parts: string[] = []

    parts.push(ANSI.CLEAR_SCREEN)
    parts.push(ANSI.MOVE_HOME)
    parts.push(ANSI.HIDE_CURSOR)

    if (state.taskName) {
      const spinner = state.spinnerActive
        ? SPINNER_FRAMES[state.spinnerFrame % SPINNER_FRAMES.length]
        : "✓"
      const taskLine = `${spinner} ${state.taskName} ${state.current}/${state.total}`
      parts.push(taskLine)
      parts.push("\n")
    }

    const divider = "─".repeat(width)
    parts.push(divider)
    parts.push("\n")

    if (state.latestMessage) {
      parts.push(state.latestMessage)
    }

    parts.push(ANSI.SHOW_CURSOR)

    return parts.join("")
  }

  const service: TerminalUI = {
    setTask: (name: string, current: number, total: number) =>
      Ref.update(stateRef, (state) => ({
        ...state,
        taskName: name,
        current,
        total,
        spinnerActive: true,
      })),

    updateMessage: (text: string) =>
      Ref.update(stateRef, (state) => ({
        ...state,
        latestMessage: text,
      })),

    markTaskPassed: () =>
      Ref.update(stateRef, (state) => ({
        ...state,
        current: state.current + 1,
        spinnerActive: false,
      })),

    clear: () => Ref.set(stateRef, initialState),

    getState: () => Ref.get(stateRef),

    render: () =>
      Effect.gen(function* () {
        yield* Ref.update(stateRef, (s) => ({
          ...s,
          spinnerFrame: s.spinnerFrame + 1,
        }))

        if (!quiet) {
          const state = yield* Ref.get(stateRef)
          const output = buildOutput(state)
          process.stdout.write(output)
        }
      }),
  }

  return service
})

export const TerminalUILive = (quiet: boolean) => Layer.effect(TerminalUITag, makeTerminalUI(quiet))
