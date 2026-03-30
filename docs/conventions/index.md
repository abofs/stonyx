# Stonyx Framework Conventions

Universal rules that apply to every Stonyx project. Section-specific conventions are linked below.

## Universal Rules

- **One class per file** — each file exports a single default class (or function for transforms)
- **Constants**: shared across files → dedicated constants file; single-use → top of the consuming file
- **No `console.log` / `.warn` / `.error`** — use `log` from `stonyx/log` for all logging
- **Check `@stonyx/utils` first** — before reaching for Node built-ins or npm packages, check if `@stonyx/utils` already provides what you need (file I/O, object manipulation, string transforms, date/timestamp, promises, prompts). File issues on stonyx-utils for gaps rather than working around them
- **`fs` is prohibited** — use file utilities from `@stonyx/utils/file` instead
- **Always LTS Node or higher** — version specified in `.nvmrc`
- **Always pnpm** — never npm or yarn
- **Lint config**: import from `@abofs/code-conventions`; never define local lint rules
- **ES Modules** — all projects use `"type": "module"` and ESM imports

## Section Conventions

- [Project Structure](./project-structure.md) — directory layout, file organization, config conventions
- [Framework Modules](./framework-modules.md) — when to use which `@stonyx/*` module
- [Cron Conventions](./cron-conventions.md) — scheduling, job model, CronService API, ORM data model
- [ORM Conventions](./orm-conventions.md) — models, serializers, access control, transforms, hooks
- [REST Conventions](./rest-conventions.md) — REST server request classes and handlers
- [Discord Conventions](./discord-conventions.md) — Discord bot commands and event handlers
- [Testing Conventions](./testing-conventions.md) — test organization, patterns, and tooling
