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

Scaffolds a new Stonyx project in the current directory. Prompts for a project name and which modules to include, then generates the project structure and runs `pnpm install`. **A failed install is reported through the exit code** — see [Exit codes](#exit-codes) below.

```bash
stonyx new              # Prompts for project name
stonyx new my-app       # Creates my-app/ in the current directory
```

Scaffolded projects are TypeScript-first: every consumer-authored source file is `.ts`, with a root `tsconfig.json`, and `tsx`/`typescript` in `devDependencies`.

#### Exit codes

The status code distinguishes a scaffolded-and-installed project from a
scaffolded-but-broken one, which is what a CI job, supervisor or wrapper reads.
Measured 2026-09-05 against `stonyx@0.2.3-beta.96`, driving the real command (the
install arms with a stub `pnpm` on `PATH` so the outcome is deterministic and offline):

| condition | exit | left on disk | printed |
|---|---|---|---|
| `pnpm install` exits 0 | **0** | project directory, dependencies installed | `✓ Project "<name>" created successfully!` |
| `pnpm install` fails | **1** | project directory **without `node_modules`** | `✗ Project "<name>" was created, but its dependencies are NOT installed.` |
| target directory already exists | **1** | nothing written | `Directory "<name>" already exists.` |
| no project name given and none entered | **1** | nothing written | `Project name is required.` |
| stdin is not a TTY | **1** | nothing written | the `confirm()` error quoted below |

Two consequences worth stating plainly:

- **A failed install is not rolled back.** The project directory and its
  `package.json` remain, so `cd <name> && pnpm install` resumes it rather than
  requiring a re-scaffold. Do not treat exit 1 as "nothing happened" — check whether
  the directory exists before retrying `stonyx new`, which refuses an existing one.
- **Exit 1 is not specific to the install.** Every failure above shares it. Scripts
  that need to tell them apart should test for the project directory, not parse the
  message.

Until 2026-09-05 the failed-install case printed the *success* banner and exited **0**
(abofs/stonyx#113), so a pipeline gated only on the status of `stonyx new` would have
continued into a project with no dependencies.

**`stonyx new` requires a TTY on stdin.** The module questions are interactive and
there is no non-interactive mode. With stdin piped or closed it exits 1 before creating
anything (measured 2026-09-05: `$PWD` empty afterwards, both `< /dev/null` and piped),
with the full message

```
Error: Interactive confirm() requires a TTY on stdin. For headless/container deployments, use the autoMigrate config option instead.
```

The second sentence comes from `@stonyx/utils`' shared `confirm()` and **does not apply
to `stonyx new`** — `autoMigrate` is an ORM option and there is no such escape here.
Automated harnesses must drive the command under a pty (for example `expect`); a
`--yes` / `--modules=` flag is not yet filed as its own issue.

**What the generated manifest declares.** The core is written to `dependencies`,
pinned to the exact version of the `stonyx` package that ran the command, and every
selected `@stonyx/*` module is written to `devDependencies` at the dist-tag of that
core's release line — `beta` from a `0.2.3-beta.n` core, `latest` from a stable one.
Neither the core nor any module is scaffolded at a floating `latest` while the core is
on a prerelease line; see
[Modules — Why not `latest`](modules.md#why-not-latest) for the measurement behind
that choice.

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
