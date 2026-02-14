import { Effect, Layer } from "effect"
import { ProviderTag, type Provider, type ProviderResponse } from "../Provider.ts"
import type { UserStory, Prd } from "../Prd.ts"

// -- Stub implementation -----------------------------------------------------

const notImplemented = (method: string): never => {
  throw new Error(`CodexProvider.${method} not implemented`)
}

const buildPrompt = (_task: UserStory, _prd: Prd): string =>
  notImplemented("buildPrompt")

const invoke = (_prompt: string, _quiet: boolean): Effect.Effect<string> =>
  Effect.die(new Error("CodexProvider.invoke not implemented"))

const parseResponse = (_output: string): ProviderResponse =>
  notImplemented("parseResponse")

const invokePlan = (_message: string, _interactive: boolean, _quiet: boolean): Effect.Effect<number> =>
  Effect.die(new Error("CodexProvider.invokePlan not implemented"))

// -- Provider ----------------------------------------------------------------

export const CodexProvider: Provider = {
  buildPrompt,
  invoke,
  parseResponse,
  invokePlan,
}

export const CodexProviderLive = Layer.succeed(ProviderTag, CodexProvider)
