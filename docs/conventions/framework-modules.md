# Framework Modules

When to use which `@stonyx/*` module. Always check these before reaching for Node built-ins or npm packages.

## Module `config/environment.js` is always JavaScript

Every `@stonyx/*` module that exposes default configuration does so through `config/environment.js`. This file is a **consumer contract**, not implementation code.

- Node's type-strip loader refuses to process `.ts` files inside `node_modules`, so a module shipping a `.ts` config cannot be loaded by any consumer, whatever the loader supports.
- This is a **runtime** constraint, not a loader one. `importConfig` resolves `config/environment.ts` then `config/environment.js` for *any* base path (see [Configuration](../configuration.md#environment-config)); it is Node that refuses the file once it sits under `node_modules`.
- A module that ships `config/environment.ts` therefore fails. **What you see depends on which layer you are looking at** — measured end-to-end through `loadModules` (the only production path for module configs):
  - **stderr** gets the precise cause, because `src/modules.ts:117` does `console.error(error)` with the loader's own error: `Config present but not loadable: …/config/environment.ts exists, but this Node runtime refused to load it (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING): Stripping types is currently unsupported for files under node_modules, for "…"`.
  - **The thrown error — the one the caller and any supervisor actually receives — is still the generic `Stonyx modules with async loading must have a config/environment.js file with default configurations. Module "@stonyx/<name>" failed to load.`** `src/modules.ts:118` replaces the loader's error with this one and attaches no `cause`, so the original is not recoverable programmatically.
  - That thrown message is **byte-identical** to the one a module with no config at all produces. On the module path the two states are still indistinguishable to the caller; only the stderr line tells them apart. So: **read stderr**, and do not rely on the thrown message to tell you a `.ts` config was refused (abofs/stonyx#105).
  - Relabelling in `src/modules.ts` is out of scope for #105 and belongs to abofs/stonyx#108 — see the note at the end of this section.

TS-migration PRs in `@stonyx/*` modules **must** skip `config/environment.*` — leave it as `.js`. If you find a module shipping `config/environment.ts`, that is a P0 consumer crash; rename it back to `.js` immediately.

> **Note for abofs/stonyx#108 (module-loader error handling).** Two facts measured at this head, both about `src/modules.ts:116-119`:
> 1. `importConfig`'s "present but not loadable" distinction **does not survive end-to-end on the module path**. It is produced correctly by the loader and then discarded by the relabel; a fixture shipping `config/environment.ts` and a fixture shipping no config at all throw the same string.
> 2. **The rethrow carries no `cause`.** `new Error(…)` at `src/modules.ts:118` is constructed without an options bag, so a supervisor that catches it loses the original error entirely — `error.cause` is `undefined`, not merely unhelpful. (`importConfig` itself does pass `{ cause }`; it is the relabel that drops it.)

## `stonyx/log`

All logging goes through `stonyx/log` (see universal rules in [conventions index](./index.md)).

```js
import log from 'stonyx/log';

log.info('Server started');
log.error('Connection failed', error);
```

Custom log types can be configured in `config/environment.js`:

```js
export default {
  socket: { logColor: 'magenta' }
}
```

## `@stonyx/utils`

Utility library organized by domain. Always check here before using Node built-ins or adding npm dependencies.

### File I/O (`@stonyx/utils/file`)

- `createFile(filePath, data, options?)` — write a new file (creates parent dirs)
- `updateFile(filePath, data, options?)` — atomic update via swap file
- `copyFile(sourcePath, targetPath, options?)` — copy with optional overwrite
- `readFile(filePath, options?)` — read file, supports `{ json: true }` and `{ missingFileCallback }`
- `deleteFile(filePath, options?)` — delete file, supports `{ ignoreAccessFailure: true }`
- `createDirectory(dir)` — recursive mkdir
- `deleteDirectory(dir)` — recursive rm
- `forEachFileImport(dir, callback, options?)` — iterate and dynamically import all `.js` files in a directory
- `fileExists(filePath)` — check existence

### Object Manipulation (`@stonyx/utils/object`)

- `deepCopy(obj)` — deep clone via JSON
- `objToJson(obj, format?)` — stringify with formatting
- `makeArray(obj)` — wrap in array if not already
- `mergeObject(obj1, obj2, options?)` — deep merge objects, supports `{ ignoreNewKeys: true }`
- `get(obj, path)` — dot-path property access (e.g., `get(obj, 'a.b.c')`)
- `getOrSet(map, key, defaultValue)` — get from Map or set default (supports factory functions)

### String Transforms (`@stonyx/utils/string`)

- `kebabCaseToCamelCase(str)` — `'my-thing'` → `'myThing'`
- `kebabCaseToPascalCase(str)` — `'my-thing'` → `'MyThing'`
- `camelCaseToKebabCase(str)` — `'myThing'` → `'my-thing'`
- `generateRandomString(length?)` — alphanumeric random string (default 8 chars)
- `pluralize(str)` — basic pluralization

### Date / Timestamp (`@stonyx/utils/date`)

- `getTimestamp(dateObject?)` — Unix timestamp in seconds (current time if no arg)

### Promises (`@stonyx/utils/promise`)

- `sleep(seconds)` — async delay

### Interactive Prompts (`@stonyx/utils/prompt`)

- `confirm(question)` — yes/no prompt, returns boolean
- `prompt(question)` — free-text input, returns string

File issues on `stonyx-utils` for any gaps rather than adding workarounds or npm dependencies.

## `@stonyx/events`

All pub/sub event handling. Never create custom event emitters.

- `setup(eventNames)` — register valid event names
- `subscribe(event, callback)` — listen for events
- `once(event, callback)` — single-fire listener
- `unsubscribe(event, callback)` — remove listener
- `emit(event, ...args)` — fire event
- `clear(event)` / `reset()` — cleanup

## `@stonyx/cron`

All scheduled and interval tasks. Never use raw `setInterval` or `setTimeout` for recurring work.

**Legacy API** — simple recurring callbacks:

- `register(key, callback, interval, runOnInit?)` — schedule a recurring job
- `unregister(key)` — cancel a job

**Advanced API** (`@stonyx/cron/service`) — full scheduling with CRUD, run history, and AI normalization:

- `add(input)` / `get(id)` / `update(id, patch)` / `remove(id)` / `list(opts?)` — CRUD
- `run(id, mode?)` — manual execution (`'force'` or `'due'`)
- `runs(id, limit?)` — run history
- `onJobDue` — callback for job execution

Three schedule kinds: `every` (interval), `cron` (expression), `at` (one-shot).

See [Cron Conventions](./cron-conventions.md) for full details.

Configurable via `config/environment.js`:

```js
export default {
  cron: { log: true }
}
```

## `@stonyx/sockets`

WebSocket handlers. Class ordering: static properties → `server()` method → `client()` method.

Exports: `SocketServer`, `SocketClient`, `Handler`, `Sockets`

## `@stonyx/discord`

Discord bot with command and event handler auto-discovery. Class ordering: static properties → `data` / `static event` → `execute()` / `handle()`.

Exports: `DiscordBot`, `Command`, `EventHandler`, `Discord`, `chunkMessage`

## `@stonyx/oauth`

OAuth providers. Class ordering: constructor with `super()` → async methods → transform methods.

Key methods: `getAuthorizationUrl()`, `handleCallback()`, `getSession()`, `logout()`

## `@abofs/code-conventions`

Shared lint and formatting config. Import and spread; never define local rules.

Exports:
- `@abofs/code-conventions/eslint` — ESLint config
- `@abofs/code-conventions/prettier` — Prettier config
- `@abofs/code-conventions/eslint-ember` — Ember-specific ESLint
- `@abofs/code-conventions/template-lint` — Template linting
- `@abofs/code-conventions/lint-staged` — Lint-staged config
