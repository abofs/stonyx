# Developing Modules

Guide for building custom Stonyx modules.

## Package Setup

Your module's `package.json` must include:

```json
{
  "name": "@stonyx/my-module",
  "keywords": ["stonyx-module"],
  "main": "src/index.js"
}
```

Add `stonyx-async` to keywords if your module requires asynchronous initialization.

## Module Class

Export a default class. Optionally define `init()`, `startup()`, and `shutdown()` methods:

```js
export default class MyModule {
  // Called during module loading (async modules only)
  async init() {
    // Connect to services, load resources, etc.
  }

  // Called after ALL modules are initialized, before app entry runs
  async startup() {
    // Register routes, start listeners, etc.
  }

  // Called on SIGTERM/SIGINT, in reverse load order
  async shutdown() {
    // Close connections, flush data, etc.
  }
}
```

## Default Configuration

Async modules must include `config/environment.js` with sensible defaults:

```js
export default {
  logColor: 'cyan',
  logMethod: 'myModule',
  logTimestamp: true,
  // Module-specific defaults...
};
```

User project config is merged on top of these defaults.

## Waiting for Other Modules

If your module depends on another async module being ready:

```js
import { waitForModule } from 'stonyx';

export default class MyModule {
  async init() {
    await waitForModule('rest-server');
    // @stonyx/rest-server is now fully initialized
  }
}
```

Pass the module name without the `@stonyx/` prefix.

## Standalone Development

When running a module standalone (project path contains `stonyx-`), Stonyx auto-transforms the config structure. Your module's config is wrapped under its camelCase name:

```js
// If your module is @stonyx/rest-server and config is { port: 3000 }
// Stonyx transforms it to: { restServer: { port: 3000 } }
```

## Custom CLI Commands

Modules can register CLI commands by adding a `./commands` export:

```json
{
  "exports": {
    "./commands": "./src/commands.js"
  }
}
```

```js
// src/commands.js
export default {
  'my-module:setup': {
    description: 'Initialize module resources',
    bootstrap: true,
    run: async ({ args, cwd }) => {
      // Command implementation
    }
  }
};
```

Use namespaced command names (e.g., `my-module:setup`) to avoid conflicts with other modules. See [CLI](cli.md#module-commands) for details.
