import { FileSystem, Path } from "@effect/platform"
import { Context, Effect, Layer, Schema } from "effect"

export class RalphConfigSchema extends Schema.Class<RalphConfigSchema>("RalphConfigSchema")({
  maxIterations: Schema.optionalWith(Schema.Number, { default: () => 50 }),
  completionMarker: Schema.optionalWith(Schema.String, { default: () => "RALPH_COMPLETE" }),
  dir: Schema.optionalWith(Schema.String, { default: () => ".ralph" }),
  promptTemplate: Schema.optional(Schema.String),
}) {}

export type RalphConfigInput = typeof RalphConfigSchema.Encoded

export class RalphConfig extends Context.Tag("RalphConfig")<
  RalphConfig,
  RalphConfigSchema
>() {}

const emptyRecord: Record<string, unknown> = {}

const readJsonSafe = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const content = yield* fs.readFileString(path)
    return JSON.parse(content) as Record<string, unknown>
  }).pipe(Effect.catchAll(() => Effect.succeed(emptyRecord)))

const deepMerge = (
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> => {
  const result = { ...base }
  for (const key of Object.keys(override)) {
    const val = override[key]
    if (val !== undefined) {
      result[key] = val
    }
  }
  return result
}

/** Load config from 3 sources (ascending priority): package.json["ralph"] → ralph.json → <dir>/config.json */
export const loadConfig = (overrides: {
  readonly dir?: string
  readonly config?: string
}) =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path

    // Source 1: package.json["ralph"]
    const pkg = yield* readJsonSafe("package.json")
    const pkgConfig = (pkg["ralph"] ?? {}) as Record<string, unknown>

    // Source 2: ralph.json or explicit --config
    const configPath = overrides.config ?? "ralph.json"
    const fileConfig = yield* readJsonSafe(configPath)

    // Merge sources 1 + 2
    let merged = deepMerge(pkgConfig, fileConfig)

    // Determine dir from merged so far, then override
    const dir = overrides.dir ?? (merged["dir"] as string | undefined) ?? ".ralph"
    merged = deepMerge(merged, { dir })

    // Source 3: <dir>/config.json
    const dirConfig = yield* readJsonSafe(pathService.join(dir, "config.json"))
    merged = deepMerge(merged, dirConfig)

    // CLI overrides take highest priority
    if (overrides.dir !== undefined) {
      merged = deepMerge(merged, { dir: overrides.dir })
    }

    return yield* Schema.decode(RalphConfigSchema)(merged)
  })

export const RalphConfigLive = (overrides: {
  readonly dir?: string
  readonly config?: string
}) =>
  Layer.effect(
    RalphConfig,
    loadConfig(overrides),
  )
