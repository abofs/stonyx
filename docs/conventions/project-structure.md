# Project Structure

## Entry Point

The application entry point is `app.ts` (preferred) or `app.js` at the project root — `stonyx serve` resolves `.ts` first and falls back to `.js` (see [CLI](../cli.md#serve)). This file exports a default class that initializes the application.

```js
import log from 'stonyx/log';

export default class App {
  constructor() {
    if (App.instance) return App.instance;
    App.instance = this;

    this.ready = this.init();
  }

  async init() {
    log.info('Initializing Application');
    // Application setup here
    log.info('Application has been initialized');
  }
}
```

## File Layout

Flat file structure at root level — non-directory project files live at the project root.

### Standard Directories

A module loads files only from the directories it is configured to discover. Each default below can be changed through the config key shown (or its environment variable).

| Directory | Discovered by | Config key (env var) |
|-----------|---------------|----------------------|
| `config/` | Stonyx core (`config/environment.js`) | — |
| `models/` | `@stonyx/orm` | `orm.paths.model` (`ORM_MODEL_PATH`) |
| `serializers/` | `@stonyx/orm` | `orm.paths.serializer` (`ORM_SERIALIZER_PATH`) |
| `transforms/` | `@stonyx/orm` | `orm.paths.transform` (`ORM_TRANSFORM_PATH`) |
| `views/` | `@stonyx/orm` | `orm.paths.view` (`ORM_VIEW_PATH`) |
| `access/` | `@stonyx/orm`, when its REST routes are enabled | `orm.paths.access` (`ORM_ACCESS_PATH`) |
| `requests/` | `@stonyx/rest-server` (not recursive) | `restServer.dir` (`REST_REQUEST_PATH`) |
| `discord-commands/` | `@stonyx/discord` | `discord.commandDir` (`DISCORD_COMMAND_DIR`) |
| `discord-events/` | `@stonyx/discord` | `discord.eventDir` (`DISCORD_EVENT_DIR`) |
| `socket-handlers/` | `@stonyx/sockets` | `sockets.handlerDir` (`SOCKET_HANDLER_DIR`) |

Nothing else is discovered. Directories the app owns, such as `test/`, `utils.js` or `utils/` (project-specific logic; never duplicate `@stonyx/utils`), `clients/` (external API clients), `scripts/` (standalone scripts, see [the exception to the universal rules](./index.md#standalone-scripts-are-the-exception)), or code that registers ORM hooks or cron jobs, run only when your code imports them, for example from `app.js`. In particular, there is no `hooks/` directory: ORM hooks are registered by calling `beforeHook` / `afterHook` (see [ORM Conventions](./orm-conventions.md#hooks)), and cron jobs by calling `register` or `CronService.add`.

### Nested Model Directories

Use nested directories under `models/` for `belongsTo` child models:

```
models/
  character.js
  character/
    relationship.js
```

## Config Conventions

### `config/environment.ts` (or `config/environment.js`)

Destructure env vars at the top, apply defaults with `??`, export a plain object:

```js
const {
  CORS_ORIGIN,
  DB_FILE,
  NODE_ENV,
  REST_PORT,
} = process.env;

const environment = NODE_ENV ?? 'development';

export default {
  orm: {
    db: {
      file: DB_FILE ?? 'db.json',
      schema: './config/db-schema.js'
    }
  },
  restServer: {
    origin: CORS_ORIGIN ?? '*',
    port: REST_PORT ?? 3000
  }
}
```

**Do NOT re-declare module defaults.** Only include config values that differ from the module's built-in defaults.

### `config/db-schema.js`

Extends `Model` and uses `hasMany` to define each collection:

```js
import { Model, hasMany } from '@stonyx/orm';

export default class DBModel extends Model {
  owners = hasMany('owner');
  animals = hasMany('animal');
}
```

## Reference

Each module's `test/sample/` directory is the reference for the files that go in that module's directory; the [Testing Conventions](./testing-conventions.md#sample--fixture-files) table lists them. `test/sample/` mirrors this layout, with the module's test config pointing the discovery paths there.
