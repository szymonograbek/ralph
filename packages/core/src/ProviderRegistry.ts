import { Effect, Layer } from "effect"
import { ProviderTag } from "./Provider.ts"
import { ClaudeProviderLive } from "./ClaudeProvider.ts"
import { CodexProviderLive } from "./providers/CodexProvider.ts"
import { RalphConfig } from "./Config.ts"
import type { TerminalUITag } from "./TerminalUI.ts"

// -- Layer -------------------------------------------------------------------

const providerLayers: Record<string, Layer.Layer<ProviderTag, never, TerminalUITag>> = {
  claude: ClaudeProviderLive,
  codex: CodexProviderLive,
}

export const ProviderLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const config = yield* RalphConfig
    const providerType = config.provider.type

    const layer = providerLayers[providerType]
    if (!layer) {
      return yield* Effect.fail(
        new Error(
          `Unknown provider type: "${providerType}". Available: ${Object.keys(providerLayers).join(", ")}`,
        ),
      )
    }

    return layer
  }),
)
