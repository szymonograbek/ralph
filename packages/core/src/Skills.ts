import { FileSystem, Path } from "@effect/platform"
import { Console, Effect } from "effect"
import { homeDir } from "./homeDir.ts"

const SKILLS_DIR = ".claude/skills"

/** Symlink project skills from .claude/skills/* to ~/.claude/skills/* */
export const linkSkills = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  const source = pathService.resolve(SKILLS_DIR)
  const target = pathService.join(homeDir, SKILLS_DIR)

  const exists = yield* fs.exists(source)
  if (!exists) {
    return yield* Effect.fail(new Error(`No skills directory at ${source}`))
  }

  yield* fs.makeDirectory(target, { recursive: true })

  const entries = yield* fs.readDirectory(source)
  const dirs = yield* Effect.filter(entries, (entry) =>
    fs.stat(pathService.join(source, entry)).pipe(Effect.map((s) => s.type === "Directory")),
  )

  yield* Effect.forEach(dirs, (name) => {
    const from = pathService.join(source, name)
    const to = pathService.join(target, name)
    return fs.remove(to, { recursive: true }).pipe(
      Effect.catchAll(() => Effect.void),
      Effect.andThen(fs.symlink(from, to)),
      Effect.andThen(Console.log(`${name} → ${to}`)),
    )
  })

  yield* Console.log(`Linked ${dirs.length} skill(s) globally`)
})
