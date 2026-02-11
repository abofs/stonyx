# Module System

Stonyx uses a plug-and-play module architecture. Modules are automatically detected, loaded, and initialized at startup.

## How Modules Are Discovered

Stonyx scans your project's `devDependencies` for packages prefixed with `@stonyx/`. Each matching package must include the `stonyx-module` keyword in its `package.json` to be loaded.

```json
{
  "name": "@stonyx/my-module",
  "keywords": ["stonyx-module"],
  "main": "src/index.js"
}
```

## Sync vs Async Modules

### Sync Modules

Modules with only the `stonyx-module` keyword are treated as synchronous. They are instantiated but their promise resolves immediately — no init phase is awaited.

### Async Modules

Modules that also include the `stonyx-async` keyword require initialization before they're ready:

```json
{
  "keywords": ["stonyx-module", "stonyx-async"]
}
```

Async modules **must** include a `config/environment.js` with default configuration. This is merged with the user's project config before initialization.

Async modules can define an `init()` method that Stonyx awaits:

```js
export default class MyModule {
  async init() {
    // Connect to database, start server, etc.
  }
}
```

All module `init()` calls run concurrently via `Promise.all`.

## Module Lifecycle

1. **Discovery** — scan `devDependencies` for `@stonyx/*` packages
2. **Validation** — verify `stonyx-module` keyword exists
3. **Config merge** — async module defaults merged with user config
4. **Log setup** — module-specific Chronicle log created if `logColor` is set
5. **Instantiation** — module class is `new`'d
6. **Initialization** — `init()` called (async modules only)
7. **Startup hooks** — `startup()` called after all modules init (see [Lifecycle](lifecycle.md))
8. **Shutdown hooks** — `shutdown()` called on process exit (see [Lifecycle](lifecycle.md))

## waitForModule

For submodule developers who need to ensure another async module is ready:

```js
import { waitForModule } from 'stonyx';

await waitForModule('rest-server'); // Waits for @stonyx/rest-server
```

> **Note:** `waitForModule` is only needed during submodule development or testing. End-user applications don't need it — the CLI ensures all modules are initialized before running your app.

## Official Modules

| Module | Description |
|--------|-------------|
| [@stonyx/cron](https://github.com/abofs/stonyx-cron) | Lightweight async job scheduling with min-heap |
| [@stonyx/rest-server](https://github.com/abofs/stonyx-rest-server) | Dynamic REST server with auto-route registration |
| [@stonyx/orm](https://github.com/abofs/stonyx-orm) | ORM with models, relationships, serializers, and optional REST integration |

See each module's repository for its specific documentation.
