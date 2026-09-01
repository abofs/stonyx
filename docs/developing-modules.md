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

Async modules must include `config/environment.ts` (preferred) or `config/environment.js` with sensible defaults:

```ts
export default {
  logColor: 'cyan',
  logMethod: 'myModule',
  logTimestamp: true,
  // Module-specific defaults...
};
```

Stonyx's loader tries `.ts` first, then falls back to `.js` for back-compat with modules that haven't migrated. If a module ships both, `.ts` wins and a warning is logged — the `.js` is almost certainly a stale compiled artifact and should be removed before publishing.

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

When a stonyx module runs its own tests (or is otherwise started as a standalone app), Stonyx auto-wraps the flat test config under the module's camelCase key so module code can read `config.myModule.*` exactly as it would in a consumer app.

**Detection signal:** Stonyx reads the consumer's `package.json#name`:

- `@stonyx/rest-server` (scoped) → wraps under `restServer`
- `stonyx-rest-server` (unscoped fallback) → wraps under `restServer`
- Anything else (including missing / malformed `package.json`) → no transform, config is used as-is

```js
// If your module is @stonyx/rest-server and config is { port: 3000 }
// Stonyx transforms it to: { restServer: { port: 3000 } }
```

Sibling `config.modules` entries are flattened into the result alongside the wrapped module:

```js
// Input config:
//   { port: 3000, modules: { other: { enabled: true } } }
// Transformed to:
//   { restServer: { port: 3000, modules: { ... } }, other: { enabled: true } }
```

**Migration note:** prior versions used a `rootPath.includes('stonyx-')` heuristic, which misfired in worktrees and forks with non-canonical paths. If you maintain a fork, make sure your `package.json#name` still starts with `@stonyx/` or `stonyx-`, or explicitly pass the wrapped config shape from your app's entry point.

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
