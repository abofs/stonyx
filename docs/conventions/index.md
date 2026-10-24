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

The logging rule applies to code running inside a booted Stonyx app. A standalone script that runs on its own with `node` (a slash-command deploy script, a one-off data fix) logs with `console`, because `stonyx/log` and `stonyx/config` throw `Stonyx has not been initialized yet` when they are imported outside a booted app. Read settings from `process.env` for the same reason.

The file rule still holds in a script: `@stonyx/utils/*` loads without a booted app, so use `@stonyx/utils/file` when `@stonyx/utils` is a dependency of the app, and `node:fs` only when it is not.

Most other framework imports throw the same way, because they import `stonyx/log` or `stonyx/config`. The package roots of `@stonyx/orm`, `@stonyx/rest-server`, `@stonyx/discord`, `@stonyx/cron`, `@stonyx/sockets` and `@stonyx/oauth` all throw, and so do several subpaths (for example `@stonyx/cron/service`, `@stonyx/sockets/server`, `@stonyx/oauth/auth-request`). Before using an import in a script, check it the same way: `node --input-type=module -e "await import('<specifier>')"`. `@stonyx/events` and the base-class subpaths (`@stonyx/discord/base`, `@stonyx/sockets/handler`, `@stonyx/oauth/oauth-flow`) load.

The reference is `test/sample/scripts/deploy-commands.js` in the `@stonyx/discord` repository (abofs/stonyx-discord, private; the file is not in the npm package). It imports `readdir` from `node:fs/promises` (it assumes `@stonyx/utils` is not an app dependency), reports with `console.log` / `console.error`, and imports only `REST` and `Routes` from `@stonyx/discord/base`. Keep such scripts out of the directories a module discovers (`requests/`, `discord-commands/` and so on), for example in `scripts/`.

For a data fix on the JSON database, use `StandaloneDB` from `@stonyx/orm/standalone-db`, which reads and writes the db files without booting Stonyx. Pass the mode your app uses: `StandaloneDB` defaults to `mode: 'directory'`, while the ORM defaults to `orm.db.mode: 'file'`. Run it while the app is stopped: a running app holds the data in memory, and its next save (an autosave, when `orm.db.autosave` is `'true'` or `'onUpdate'`) writes that copy back over the script's edit.

```js
import StandaloneDB from '@stonyx/orm/standalone-db';

const db = new StandaloneDB({ dbPath: 'db.json', mode: 'file' });
const animals = await db.readCollection('animals');
// ...change records...
await db.writeCollection('animals', animals);
```

## Section Conventions

- [Project Structure](./project-structure.md) — directory layout, file organization, config conventions
- [Framework Modules](./framework-modules.md) — when to use which `@stonyx/*` module
- [Cron Conventions](./cron-conventions.md) — legacy intervals and the CronService API
- [ORM Conventions](./orm-conventions.md) — models, serializers, access control, transforms, views, hooks, store
- [REST Conventions](./rest-conventions.md) — REST server request classes and handlers
- [Discord Conventions](./discord-conventions.md) — Discord bot commands and event handlers
- [Testing Conventions](./testing-conventions.md) — test organization, patterns, and tooling
