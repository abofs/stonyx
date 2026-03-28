# Stonyx CLI Guide

See [docs/index.md](../docs/index.md) for full documentation including conventions, modules, lifecycle, and API reference.

## Installation

Stonyx is the core framework package. The CLI is provided by the `stonyx` binary defined in `package.json`.

In a project that depends on `stonyx`:

```bash
pnpm add -D stonyx
```

The CLI is then available as `npx stonyx` or via pnpm scripts.

## Commands

### `stonyx serve` (alias: `s`)

Bootstrap Stonyx and run the application.

```bash
stonyx serve              # loads app.js by default
stonyx serve --entry custom.js  # custom entry point
```

Behavior:
1. Loads `.env` file
2. Imports `config/environment.js`
3. Initializes Stonyx with all detected `@stonyx/*` modules
4. Runs startup lifecycle hooks
5. Imports and instantiates the entry point class
6. Registers SIGTERM/SIGINT handlers for graceful shutdown

### `stonyx test` (alias: `t`)

Bootstrap Stonyx in test mode and run QUnit tests.

```bash
stonyx test                          # runs test/**/*-test.js
stonyx test test/unit/foo-test.js    # specific file
stonyx test "test/integration/**/*-test.js"  # glob pattern
```

Sets `NODE_ENV=test` and auto-loads test setup which merges `test/config/environment.js` overrides.

### `stonyx help` (alias: `h`)

Show available commands including built-in and module-provided commands.

```bash
stonyx help
stonyx --help
stonyx -h
```

### `stonyx new <app-name>`

Scaffold a new Stonyx project with interactive module selection.

```bash
stonyx new my-backend
```

Prompts for:
- Package name
- Which `@stonyx/*` modules to include (REST server, WebSockets, ORM, cron, OAuth, events)

Creates:
- `package.json` with selected dependencies
- `app.js` entry point
- `config/environment.js` and `config/environment.example.js`
- Module-specific directories (`models/`, `requests/`, `crons/`, etc.)
- `test/` structure with `unit/`, `integration/`, `acceptance/`
- `.gitignore` and `.nvmrc`
- Runs `pnpm install`

## Module Command System

Stonyx modules can register CLI commands by exporting a `./commands` entry in their `package.json` exports map. The CLI auto-discovers these from installed `@stonyx/*` packages.

Module commands appear under "Module commands" in `stonyx help` output. They can optionally request Stonyx bootstrap before running (via `bootstrap: true`).

## Creating a Stonyx Project Manually

If not using `stonyx new`:

1. Create project directory
2. Add `.nvmrc` with current LTS Node version
3. `pnpm init` and set `"type": "module"`
4. `pnpm add -D stonyx` plus desired `@stonyx/*` modules
5. Create `config/environment.js` with module config
6. Create `app.js` entry point class
7. Create standard directories per selected modules
8. Add `@abofs/code-conventions` for linting
