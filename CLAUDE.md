# Ralph — Autonomous Claude Coding Loop

Bun monorepo, Effect ecosystem. Spawns fresh `claude` processes per iteration against PRD.json tasks.

## Structure

```
packages/
├── core/src/          @ralph/core — domain logic (Config, Prd, Claude, Loop)
│   ├── Config.ts      3-source config loader: package.json["ralph"] → ralph.json → <dir>/config.json
│   ├── Prd.ts         PRD schema + file I/O, UserStory state queries
│   ├── Claude.ts      Prompt building + process invocation (live/quiet modes)
│   ├── Loop.ts        Iteration engine: pick task → invoke claude → check completion
│   └── index.ts       Public API barrel
├── cli/src/           @ralph/cli — thin CLI shell over core
│   ├── bin.ts         Entry: shebang + BunContext + BunRuntime.runMain
│   └── Cli.ts         Commands (plan, continue), parent option pattern, layer wiring
└── web/               @ralph/web — stub (future UI)
```

## Where to Look

| Task | Location |
|------|----------|
| Config schema/defaults | `core/src/Config.ts` — `RalphConfigSchema` class |
| Add config source | `core/src/Config.ts` — `loadConfig` function |
| PRD structure | `core/src/Prd.ts` — `Prd`, `UserStory` schemas |
| Change prompt format | `core/src/Claude.ts` — `buildPrompt` |
| Loop exit conditions | `core/src/Loop.ts:12-42` — `iterate` function |
| Add CLI subcommand | `cli/src/Cli.ts` — add to `Command.withSubcommands` array |
| CLI option inheritance | `cli/src/Cli.ts:13-19` — `configFromParent` Effect |

## Key Patterns

**Effect everywhere**: `Effect.gen` generators, `Context.Tag` for DI, `Schema.Class` for validation, `Layer.effect` for config provision. Import `Schema` from `effect` directly (merged in v3).

**Config cascade**: 3 sources merge via `deepMerge` (ascending priority). CLI flags override all. `readJsonSafe` returns typed `emptyRecord` on failure — avoids TS `{}` literal type inference bug.

**Parent command pattern**: Global options (`--dir`, `--config`, `--quiet`) on parent `ralph` command. Subcommands access via `yield* ralph`. `RalphConfigLive` layer built inside each subcommand handler.

**Fresh context per iteration**: Loop spawns independent `claude -p` processes. No conversation history. PRD.json is single source of truth — re-read after each invocation (Claude modifies it).

**Loop termination**: 3 exit conditions — all stories pass, completion marker found, max iterations (default 50).

## Anti-Patterns

- Do NOT use Anthropic's Ralph plugin — degrades perf by keeping loops in same context window
- PRD specs must leave token budget for implementation; bloated specs hit "dumb zone" (~100k tokens)

## Dependencies

`@effect/cli@^0.56` needs undeclared peer deps: `@effect/printer`, `@effect/printer-ansi`, `@effect/typeclass` — explicit in `@ralph/cli`.

`@effect/platform-bun@0.57` peers on `@effect/platform@^0.77` — don't bump to `^0.78`.

## Commands

```bash
bun install                    # install deps
bun run typecheck              # tsc --noEmit
bun run link                   # link CLI globally (bun link --cwd packages/cli)
ralph plan "message"           # generate PRD via Claude
ralph continue                 # run loop iterations
ralph --dir .ralph --quiet continue  # custom dir, quiet mode
```
