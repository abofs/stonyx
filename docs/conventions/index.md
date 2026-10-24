# Stonyx Framework Conventions

Universal rules that apply to every Stonyx project. Section-specific conventions are linked below.

## Universal Rules

- **One class per file** — each file exports a single default class (or function for transforms)
- **Constants**: shared across files → dedicated constants file; single-use → top of the consuming file
- **No `console.log` / `.warn` / `.error` in app code** — code that runs inside a booted Stonyx app (request classes, models, commands, event handlers, socket handlers, `app.js`) logs through `log` from `stonyx/log`
- **Check `@stonyx/utils` first** — before reaching for Node built-ins or npm packages in app code, check if `@stonyx/utils` already provides what you need (file I/O, object manipulation, string transforms, date/timestamp, promises, prompts, fuzzy matching). File issues on stonyx-utils for gaps rather than working around them
- **`fs` is prohibited in app code** — use file utilities from `@stonyx/utils/file` instead
- **Always LTS Node or higher** — version specified in `.nvmrc`
- **Always pnpm** — never npm or yarn
- **Lint config**: import from `@abofs/code-conventions`; never define local lint rules
- **ES Modules** — all projects use `"type": "module"` and ESM imports

### Standalone scripts are the exception

The logging and file rules apply to code running inside a booted Stonyx app. A standalone script that runs on its own with `node` (a slash-command deploy script, a one-off data fix) uses `console` and `node:` built-ins instead. `stonyx/log` and `stonyx/config` throw `Stonyx has not been initialized yet` when they are imported outside a booted app, and `@stonyx/utils` may not be a dependency of the app at all.

The reference is `test/sample/scripts/deploy-commands.js` in the `@stonyx/discord` repository (abofs/stonyx-discord, private; the file is not in the npm package). It imports `readdir` from `node:fs/promises`, reports with `console.log` / `console.error`, and imports only `REST` and `Routes` from `@stonyx/discord/base`. Keep such scripts out of the directories a module discovers (`requests/`, `discord-commands/` and so on), for example in `scripts/`.

## Section Conventions

- [Project Structure](./project-structure.md) — directory layout, file organization, config conventions
- [Framework Modules](./framework-modules.md) — when to use which `@stonyx/*` module
- [Cron Conventions](./cron-conventions.md) — legacy intervals and the CronService API
- [ORM Conventions](./orm-conventions.md) — models, serializers, access control, transforms, views, hooks, store
- [REST Conventions](./rest-conventions.md) — REST server request classes and handlers
- [Discord Conventions](./discord-conventions.md) — Discord bot commands and event handlers
- [Testing Conventions](./testing-conventions.md) — test organization, patterns, and tooling
