# SME Template: Validation Loop Team — Stonyx

> **Inherits from:** `beatrix-shared/docs/framework/templates/agents/validation-loop-team.md`
> Load the base template first, then layer this project-specific context on top.

## Project Context

**Repo:** `abofs/stonyx`
**Framework:** Core application framework for modular Node.js projects
**Domain:** Module loading, configuration, lifecycle hooks, CLI — the foundation that all Stonyx modules and applications build on

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (ES Modules) |
| Runtime | Node.js |
| Testing | QUnit + Sinon |
| Build | `tsc` with dual configs (src and test) |
| CI | GitHub Actions (`ci.yml`) |

## Architecture Patterns

- **Singleton with static accessors:** `Stonyx.log`, `Stonyx.config` throw if accessed before initialization — guards prevent silent null-reference bugs in consumer code
- **Concurrent module init with dependency ordering:** Modules initialize in parallel via `Promise.all`, but can declare sequential dependencies through `waitForModule()` — validation must cover both concurrent and sequential initialization paths
- **Deep config merge:** `mergeObject` recursively merges module defaults with user overrides — edge cases include nested objects, arrays, and `undefined` vs missing keys
- **Reverse-order shutdown:** Modules shut down in reverse registration order with `try/catch` isolation per module — a failing shutdown must not prevent subsequent modules from cleaning up

## Live Knowledge

- Breaking changes to the module loader interface (`StoynxModule`) cascade to every `@stonyx/*` package — any change to `init()`, `startup()`, or `shutdown()` signatures requires cross-repo validation
- The `stonyx-module` and `stonyx-async` keyword detection in `package.json` is the gate for module loading — a missing keyword silently skips the module, which is an intentional design choice but a common debugging pitfall
- Config key naming follows a strict convention: `@stonyx/rest-server` maps to `config.restServer` via `kebabCaseToCamelCase` — validate that any new module name converts correctly
- The CLI (`stonyx new`, `stonyx serve`, `stonyx test`) is both a user-facing tool and the integration test surface — changes to CLI behavior affect every downstream project
- Published package includes only `dist/`, `config/`, and `README.md` (per `files` in package.json) — verify that no source files or test artifacts leak into the npm package
