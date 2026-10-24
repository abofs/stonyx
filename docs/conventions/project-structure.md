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
| `migrations/` | `@stonyx/orm`, only with a MySQL, Postgres or TimescaleDB adapter: its `*.sql` files are checked for pending migrations at startup | `orm.mysql.migrationsDir` / `orm.postgres.migrationsDir` / `orm.timescale.migrationsDir` (`MYSQL_MIGRATIONS_DIR` / `PG_MIGRATIONS_DIR` / `TIMESCALE_MIGRATIONS_DIR`) |

No module discovers anything else. Two app directories are run by tooling rather than by a module: `stonyx test` runs `test/**/*-test.{js,ts}` (see [Testing Conventions](./testing-conventions.md)), and `scripts/` holds standalone scripts you run with `node` (see [the exception to the universal rules](./index.md#standalone-scripts-are-the-exception)). Everything else the app owns, such as `utils.js` or `utils/` (project-specific logic; never duplicate `@stonyx/utils`), `clients/` (external API clients), or code that registers ORM hooks or cron jobs, runs only when your code imports it. `stonyx serve` imports `app.js`, but `stonyx test` does not, so code imported only from `app.js` does not run in tests (see [ORM Conventions](./orm-conventions.md#hooks) for hooks). In particular, there is no `hooks/` directory: ORM hooks are registered by calling `beforeHook` / `afterHook`, and cron jobs by calling `register` or `CronService.add`.

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

Each module's `test/sample/` directory is the reference for the files that go in that module's directory; the [Testing Conventions](./testing-conventions.md#sample--fixture-files) table lists them. Where a module discovers a directory, its `test/sample/` has a directory of the same name, and the module's test config points the discovery path there. The ORM's `test/sample/migrations/` is the exception: it holds only a `.gitkeep`.
