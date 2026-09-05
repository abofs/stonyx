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

| Directory | Purpose | When to create |
|-----------|---------|----------------|
| `config/` | Configuration files | Always |
| `models/` | ORM model definitions | When using `@stonyx/orm` |
| `serializers/` | Data serializers | When using `@stonyx/orm` |
| `access/` | Access control definitions | When using `@stonyx/orm` |
| `transforms/` | Value transforms | When using `@stonyx/orm` |
| `hooks/` | Lifecycle hooks | When using `@stonyx/orm` |
| `requests/` | REST request handlers | When using `@stonyx/rest-server` |
| `crons/` | Scheduled tasks | When using `@stonyx/cron` |
| `clients/` | External API clients | When fetching external data |
| `test/`| Tests | Always |
| `utils.js` or `utils/` | Project-specific reusable logic | As needed (never duplicate `@stonyx/utils`) |

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

## Reference Projects

- `smart-lock-backend/` — full example with REST, ORM, sockets, crons, hooks
- `nextgoal-backend/` — example with models, transforms, filters, bot commands
