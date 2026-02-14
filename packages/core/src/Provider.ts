import { Context, Effect } from "effect"
import type { UserStory, Prd } from "./Prd.ts"

// -- ProviderResponse --------------------------------------------------------

export interface ProviderResponse {
  readonly raw: string
  readonly containsMarker: (marker: string) => boolean
}

// -- Provider service --------------------------------------------------------

export interface Provider {
  readonly buildPrompt: (task: UserStory, prd: Prd) => string
  readonly invoke: (prompt: string, quiet: boolean) => Effect.Effect<string>
  readonly parseResponse: (output: string) => ProviderResponse
  readonly invokePlan: (message: string, interactive: boolean, quiet: boolean) => Effect.Effect<number>
}

export class ProviderTag extends Context.Tag("Provider")<ProviderTag, Provider>() {}
