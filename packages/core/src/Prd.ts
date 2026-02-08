import { FileSystem, Path } from "@effect/platform"
import { Effect, Option, Schema } from "effect"
import { RalphConfig } from "./Config.ts"

export class UserStory extends Schema.Class<UserStory>("UserStory")({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  acceptanceCriteria: Schema.Array(Schema.String),
  passes: Schema.Boolean,
  notes: Schema.String,
}) {}

export class Prd extends Schema.Class<Prd>("Prd")({
  project: Schema.Struct({ name: Schema.String, description: Schema.String }),
  userStories: Schema.Array(UserStory),
}) {}

export const readPrd = Effect.gen(function* () {
  const config = yield* RalphConfig
  const pathService = yield* Path.Path
  const fs = yield* FileSystem.FileSystem
  const prdPath = pathService.join(config.dir, "PRD.json")
  const content = yield* fs.readFileString(prdPath)
  return yield* Schema.decode(Prd)(JSON.parse(content))
})

export const writePrd = (prd: Prd) =>
  Effect.gen(function* () {
    const config = yield* RalphConfig
    const pathService = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const prdPath = pathService.join(config.dir, "PRD.json")
    yield* fs.writeFileString(prdPath, JSON.stringify(prd, null, 2))
  })

export const findNextIncomplete = (prd: Prd): Option.Option<UserStory> =>
  Option.fromNullable(prd.userStories.find((s) => !s.passes))

export const allPass = (prd: Prd): boolean =>
  prd.userStories.every((s) => s.passes)
