# SME Template: Architect — Stonyx

> **Inherits from:** `beatrix-shared/docs/framework/templates/agents/architect.md`
> Load the base template first, then layer this project-specific context on top.

## Project Context

**Repo:** `abofs/stonyx`
**Framework:** Core application framework for modular Node.js projects
**Domain:** Provides the foundational runtime — module loader, configuration system, lifecycle hooks, CLI tooling, and centralized logging — that all `@stonyx/*` modules depend on

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (compiled to ES Modules) |
| Runtime | Node.js |
| Logging | `@stonyx/logs` (Chronicle — color-coded, extensible) |
| Utilities | `@stonyx/utils` (string, file, object helpers) |
| Testing | QUnit + Sinon |
| Build | `tsc` (two configs: `tsconfig.json` for dist, `tsconfig.test.json` for dist-test) |
| Package Manager | pnpm |
| CI | GitHub Actions |

## Architecture Patterns

- **Singleton framework instance:** `Stonyx` class enforces a single instance via constructor guard; exposes static `log`, `config`, and `ready` accessors
- **Async module loader:** Scans `devDependencies` for `@stonyx/*` packages, filters by `stonyx-module` / `stonyx-async` keywords, imports each module's `config/environment.js` defaults, merges with user config, then calls `init()` concurrently
- **Deferred module readiness:** Each module gets a `DeferredPromise`; `waitForModule(name)` lets dependent modules block until their prerequisite finishes initializing (e.g., ORM waiting for rest-server)
- **Lifecycle hooks:** Modules implement `init()`, `startup()`, and `shutdown()` from the `StoynxModule` interface; shutdown runs in reverse registration order with error isolation
- **Config merge strategy:** Module defaults from `config/environment.js` are deep-merged with user overrides using `mergeObject`; test environment auto-merges from `test/config/environment.js` when `NODE_ENV=test`
- **CLI as entry point:** `stonyx serve` bootstraps the full framework; `stonyx test` sets up test environment; `stonyx new` scaffolds projects with interactive module selection
- **User-defined logging:** Any config key with a `logColor` property automatically gets a named Chronicle log method at startup

## Live Knowledge

- The module loader uses `kebabCaseToCamelCase` to convert package names (e.g., `@stonyx/rest-server` becomes `restServer` config key) — config key mismatches are a common integration issue
- Standalone module mode (when `rootPath` contains `stonyx-`) transforms config structure differently to support running modules in isolation during development
- `Stonyx.modulePromises` is populated before any module `init()` runs, so `waitForModule` is safe to call from any module's `init()` without race conditions
- The `postinstall` script handles first-time setup; `prepublishOnly` runs the full test suite before npm publish
- Exports are split across subpaths: `stonyx/config`, `stonyx/log`, `stonyx/test-helpers`, `stonyx/lifecycle` — consumer code imports these directly, not from the main entry
