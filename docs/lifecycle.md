# Lifecycle Hooks

Stonyx modules can define `startup()` and `shutdown()` methods that run at specific points in the application lifecycle.

## Startup Hooks

Called sequentially (in module load order) after all modules have been initialized, right before your application entry point runs.

```js
export default class MyModule {
  async startup() {
    // Called after all modules are init'd, before app.js runs
  }
}
```

## Shutdown Hooks

Called sequentially in **reverse** module load order when the process receives `SIGTERM` or `SIGINT`. Errors in one hook do not prevent other hooks from running.

```js
export default class MyModule {
  async shutdown() {
    // Clean up connections, flush buffers, etc.
  }
}
```

## Signal Handling

The `stonyx serve` command registers signal handlers automatically:

- **SIGTERM** — triggers shutdown hooks, then `process.exit(0)`
- **SIGINT** — triggers shutdown hooks, then `process.exit(0)`

Shutdown is idempotent — calling the handler multiple times only runs hooks once.

## Using Lifecycle Hooks Directly

For advanced use cases, the lifecycle functions are available as a public export:

```js
import { runStartupHooks, runShutdownHooks } from 'stonyx/lifecycle';

await runStartupHooks(modules);   // Calls startup() on each module in order
await runShutdownHooks(modules);  // Calls shutdown() on each module in reverse order
```
