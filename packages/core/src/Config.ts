import { FileSystem, Path } from "@effect/platform"
import { Context, Effect, Layer, Schema } from "effect"
import { homeDir } from "./homeDir.ts"

const ProviderConfigSchema = Schema.Struct({
  executable: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
})

export class RalphConfigSchema extends Schema.Class<RalphConfigSchema>("RalphConfigSchema")({
  maxIterations: Schema.optionalWith(Schema.Number, { default: () => 50 }),
  dir: Schema.optionalWith(Schema.String, { default: () => ".ralph" }),
  promptTemplate: Schema.optional(Schema.String),
  provider: Schema.optionalWith(
    Schema.Struct({
      type: Schema.optionalWith(Schema.String, { default: () => "claude" }),
      config: Schema.optionalWith(ProviderConfigSchema, { default: () => ({}) }),
    }),
    { default: () => ({ type: "claude", config: {} }) },
  ),
  /** Branches blocked from push command (prevents accidental pushes to main/master) */
  protectedBranches: Schema.optionalWith(
    Schema.Array(Schema.String),
    { default: () => ["main", "master", "develop"] },
  ),
  /** Base directory for worktrees. Defaults to ~/.ralph/worktrees */
  worktreeBasePath: Schema.optional(Schema.String),
  /** Prefix for auto-generated branch names when PRD unavailable */
  defaultBranchPrefix: Schema.optionalWith(Schema.String, { default: () => "ralph" }),
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

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const deepMerge = (
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> => {
  const result = { ...base }
  for (const key of Object.keys(override)) {
    const val = override[key]
    if (val !== undefined) {
      result[key] = isPlainObject(val) && isPlainObject(result[key])
        ? deepMerge(result[key], val)
        : val
    }
  }
  return result
}

/** Load config from 4 sources (ascending priority): ~/.ralph/config.json → package.json["ralph"] → ralph.json → <dir>/config.json */
export const loadConfig = (overrides: {
  readonly dir?: string
  readonly config?: string
}) =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path

    // Source 0: ~/.ralph/config.json (global defaults)
    const globalConfigPath = pathService.join(homeDir, ".ralph", "config.json")
    const globalConfig = yield* readJsonSafe(globalConfigPath)

    // Source 1: package.json["ralph"]
    const pkg = yield* readJsonSafe("package.json")
    const pkgConfig = (pkg["ralph"] ?? {}) as Record<string, unknown>

    // Source 2: ralph.json or explicit --config
    const configPath = overrides.config ?? "ralph.json"
    const fileConfig = yield* readJsonSafe(configPath)

    // Merge sources 0 + 1 + 2
    let merged = deepMerge(deepMerge(globalConfig, pkgConfig), fileConfig)

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
