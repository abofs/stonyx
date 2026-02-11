# API Reference

Public exports available from the `stonyx` package.

## Exports Map

| Import Path | Export | Description |
|-------------|--------|-------------|
| `stonyx` | `default` (Stonyx class) | Main framework class (singleton) |
| `stonyx` | `waitForModule(name)` | Wait for an async module to be ready |
| `stonyx/config` | `default` (config object) | Live reference to Stonyx configuration |
| `stonyx/log` | `default` (Chronicle instance) | Live reference to Chronicle logger |
| `stonyx/lifecycle` | `runStartupHooks(modules)` | Run startup hooks on a module array |
| `stonyx/lifecycle` | `runShutdownHooks(modules)` | Run shutdown hooks in reverse order |
| `stonyx/test-helpers` | `setupIntegrationTests(hooks)` | QUnit hook for integration test setup |

## Stonyx Class

```js
import Stonyx from 'stonyx';
```

### Constructor

```js
new Stonyx(config, rootPath)
```

- **config** — Full environment configuration object
- **rootPath** — Absolute path to the project root

Returns the existing instance if one already exists (singleton pattern).

### Static Properties

| Property | Type | Description |
|----------|------|-------------|
| `Stonyx.instance` | `Stonyx` | The singleton instance |
| `Stonyx.ready` | `Promise` | Resolves when all modules are initialized |
| `Stonyx.initialized` | `boolean` | Whether Stonyx has started initialization |

### Static Getters

| Getter | Returns | Throws |
|--------|---------|--------|
| `Stonyx.config` | Config object | If not initialized |
| `Stonyx.log` | Chronicle instance | If not initialized |

### Instance Properties

| Property | Type | Description |
|----------|------|-------------|
| `instance.config` | `object` | Merged environment configuration |
| `instance.chronicle` | `Chronicle` | Logger instance |
| `instance.modules` | `Array` | Loaded module instances |

## waitForModule

```js
import { waitForModule } from 'stonyx';

await waitForModule('rest-server');
```

Waits for a specific `@stonyx/*` module to complete initialization. Pass the module name **without** the `@stonyx/` prefix.

Throws if the module is not registered in project dependencies.

## Lifecycle Functions

```js
import { runStartupHooks, runShutdownHooks } from 'stonyx/lifecycle';
```

### runStartupHooks(modules)

Calls `startup()` on each module in array order. Skips modules without a `startup` method.

### runShutdownHooks(modules)

Calls `shutdown()` on each module in **reverse** array order. Errors are caught and logged — one failing hook does not prevent others from running.

## setupIntegrationTests

```js
import { setupIntegrationTests } from 'stonyx/test-helpers';
```

Registers a QUnit `before` hook that waits for `Stonyx.ready`. Use within a `module()` block to ensure Stonyx is fully initialized before tests run.
