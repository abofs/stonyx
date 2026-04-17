# CLI

Stonyx includes a CLI that handles bootstrapping, module initialization, and application execution.

## Usage

```bash
stonyx <command> [...args]
```

## Built-in Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `new` | `n` | Scaffold a new Stonyx project |
| `serve` | `s` | Bootstrap Stonyx and run the app |
| `test` | `t` | Bootstrap Stonyx in test mode and run tests |
| `help` | `h` | Show available commands |

### new

Scaffolds a new Stonyx project in the current directory. Prompts for a project name and which modules to include, then generates the project structure and runs `pnpm install`.

```bash
stonyx new              # Prompts for project name
stonyx new my-app       # Creates my-app/ in the current directory
```

Scaffolded projects are TypeScript-first: every consumer-authored source file is `.ts`, with a root `tsconfig.json`, and `tsx`/`typescript` in `devDependencies`.

Generated layout (minimal — additional directories appear per the modules you select):

```
my-app/
├── app.ts
├── config/
│   ├── environment.ts
│   └── environment.example.ts
├── test/
│   ├── setup.ts           # Bootstraps Stonyx via await Stonyx.ready (Sprint 44 pattern)
│   ├── zz-exit-test.ts    # runEnd hook that drains the event loop after tests
│   ├── config/
│   │   └── environment.ts
│   ├── unit/
│   ├── integration/
│   └── acceptance/
├── package.json
├── tsconfig.json
└── .gitignore
```

The scaffolded `package.json` uses the Sprint 44 test pattern:

```json
{
  "scripts": {
    "build": "tsc",
    "serve": "stonyx serve",
    "start": "stonyx serve",
    "test": "NODE_ENV=test node --import tsx/esm --import ./test/setup.ts node_modules/qunit/bin/qunit.js 'test/**/*-test.ts'"
  }
}
```

`config/environment.ts` is scaffolded with a typed default export so new projects get type-checking out of the box:

```ts
import type { StoynxConfig } from 'stonyx';

const config: StoynxConfig = {
};

export default config;
```

### serve

Bootstraps Stonyx (loads config, initializes modules, runs lifecycle hooks), then imports your application entry point.

```bash
stonyx serve                    # Runs app.ts (or app.js) by default
stonyx serve --entry custom.ts  # Runs a custom entry file
```

Both `.ts` and `.js` entry points are supported. When no `--entry` flag is passed, `stonyx serve` looks for `app.ts` first, then falls back to `app.js`. If both exist, `.ts` wins and a warning is logged (the `.js` is likely a stale compiled artifact). When an explicit `--entry <path>` is passed, the provided path is honored verbatim.

The serve command also registers `SIGTERM` and `SIGINT` handlers that run [shutdown hooks](lifecycle.md) before exiting.

### test

Runs your test suite using [QUnit](https://qunitjs.com/) with automatic Stonyx bootstrapping. Sets `NODE_ENV=test` and applies any [test config overrides](configuration.md#test-environment-overrides).

```bash
stonyx test                     # Runs test/**/*-test.{js,ts} by default
stonyx test "test/unit/**/*.js" # Custom test glob
```

### help

Displays all available commands, including any [module commands](#module-commands).

```bash
stonyx help
```

## Module Commands

Stonyx modules can register custom CLI commands by exporting a `./commands` entry in their `package.json`. These are automatically discovered and available through the CLI.

```json
{
  "exports": {
    "./commands": "./src/commands.js"
  }
}
```

The commands file should export an object mapping command names to definitions:

```js
export default {
  'db:migrate': {
    description: 'Run database migrations',
    bootstrap: true,
    run: async ({ args, cwd }) => { /* ... */ }
  }
};
```

- **`bootstrap: true`** — Stonyx will be fully initialized before the command runs
- **`bootstrap: false`** — The command runs without Stonyx initialization

Module commands appear under "Module commands" in `stonyx help` output. If two modules register the same command name, the first one loaded wins and a warning is printed.

## Environment Variables

The CLI automatically loads `.env` files via `process.loadEnvFile()` before executing any command.
