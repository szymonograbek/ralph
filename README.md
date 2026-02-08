# Ralph

Autonomous Claude coding loop. Each iteration: fresh headless Claude call, PRD.json as source of truth, file-based state.

## Setup

```sh
bun install
bun run link    # links `ralph` globally
```

## Usage

```sh
ralph plan "build a todo app with sqlite"   # generates PRD.json via Claude
ralph continue                               # runs loop iterations on PRD
ralph continue --quiet                       # silent mode, summary only
ralph --dir .my-ralph plan "something"       # custom working directory
```

### Options

| Flag | Description |
|------|-------------|
| `--dir <path>` | Ralph working directory (default `.ralph`) |
| `--config <path>` | Explicit config file path |
| `-q, --quiet` | Suppress live output |

## Config

Three sources, ascending priority: `package.json["ralph"]` > `ralph.json` > `<dir>/config.json`. CLI flags override all.

```json
{
  "maxIterations": 50,
  "completionMarker": "RALPH_COMPLETE",
  "dir": ".ralph",
  "promptTemplate": "optional custom prompt"
}
```

## Structure

```
packages/
  core/   @ralph/core   — config, PRD schema, Claude invocation, loop engine
  cli/    @ralph/cli    — CLI commands (plan, continue)
  web/    stub for future
```

## Dev

```sh
bun run typecheck   # tsc --noEmit
bun run link        # bun link --cwd packages/cli
```
