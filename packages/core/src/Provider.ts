import { Context, Effect, Schema } from "effect"
import type { UserStory, Prd } from "./Prd.ts"

// -- ProviderConfig ----------------------------------------------------------

export class ProviderConfig extends Schema.Class<ProviderConfig>("ProviderConfig")({
  executable: Schema.String,
  args: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }),
  env: Schema.optionalWith(
    Schema.Record({ key: Schema.String, value: Schema.String }),
    { default: () => ({}) },
  ),
}) {}

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
}

export class ProviderTag extends Context.Tag("Provider")<ProviderTag, Provider>() {}
