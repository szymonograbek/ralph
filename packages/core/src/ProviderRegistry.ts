import { Effect, Layer } from "effect"
import { ProviderTag, type Provider } from "./Provider.ts"
import { ClaudeProvider } from "./ClaudeProvider.ts"
import { CodexProvider } from "./providers/CodexProvider.ts"
import { RalphConfig } from "./Config.ts"

// -- Registry ----------------------------------------------------------------

export const ProviderRegistry: Record<string, Provider> = {
  claude: ClaudeProvider,
  codex: CodexProvider,
}

// -- Layer -------------------------------------------------------------------

export const ProviderLive = Layer.effect(
  ProviderTag,
  Effect.gen(function* () {
    const config = yield* RalphConfig
    const providerType = config.provider.type

    const provider = ProviderRegistry[providerType]
    if (!provider) {
      return yield* Effect.fail(
        new Error(
          `Unknown provider type: "${providerType}". Available: ${Object.keys(ProviderRegistry).join(", ")}`,
        ),
      )
    }

    return provider
  }),
)
