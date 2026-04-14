# SME Template: QA Test Engineer — Stonyx

> **Inherits from:** `beatrix-shared/docs/framework/templates/agents/qa-test-engineer.md`
> Load the base template first, then layer this project-specific context on top.

## Project Context

**Repo:** `abofs/stonyx`
**Framework:** Core application framework for modular Node.js projects
**Domain:** Runtime module loading, configuration merging, lifecycle management, and CLI tooling

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Test Runner | QUnit |
| Mocking | Sinon |
| Build (tests) | `tsc -p tsconfig.test.json` (outputs to `dist-test/`) |
| Test Command | `pnpm build && pnpm build:test && qunit 'dist-test/test/**/*-test.js'` |

## Architecture Patterns

- **Two-stage build for tests:** Source compiles to `dist/`, tests compile separately to `dist-test/` with their own `tsconfig.test.json` — tests import from `dist/` so both builds must succeed
- **Unit tests only:** Tests live under `test/unit/` — no integration test directory exists; framework is tested in isolation from downstream modules
- **Config override mechanism:** Test environment automatically merges `test/config/environment.js` when `NODE_ENV=test`, enabling per-test config without modifying source
- **Singleton reset required:** The `Stonyx` singleton persists across tests; teardown must reset `Stonyx.instance`, `Stonyx.initialized`, and `Stonyx.modulePromises` to avoid test pollution

## Live Knowledge

- Tests run via the `stonyx test` CLI command in downstream projects, but this repo uses `qunit` directly since it IS the framework
- The `dist-test/` directory mirrors the `test/` structure; import paths in test files must account for the relative path from `dist-test/test/` to `dist/`
- Module loading tests need to mock `@stonyx/utils/file` (specifically `readFile` for package.json parsing and `forEachFileImport` for module discovery) since real module resolution depends on `node_modules` layout
- Chronicle (logging) tests should verify that `logColor` / `logMethod` / `logTimestamp` config keys produce the correct `defineType` calls — these are the user-facing log configuration hooks
- The `waitForModule` function is a critical test target: verify it resolves when the module initializes, throws for unregistered modules, and handles concurrent callers correctly
