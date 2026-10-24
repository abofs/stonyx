# Framework Modules

When to use which `@stonyx/*` module. Always check these before reaching for Node built-ins or npm packages.

## A module never declares `stonyx` in `dependencies`

**Rule.** A `@stonyx/*` module declares the core in `devDependencies` — pinned to the
version it develops and tests against — plus a **non-optional** `peerDependencies`
range. It never declares `stonyx` in `dependencies`.

**The principle the rule protects.** An application must resolve exactly one copy of
`stonyx`, because the framework is a singleton: `Stonyx.start()` initialises one core,
and any module holding a different copy sees an uninitialised framework. A peer range
is satisfied by the copy the application already resolved; a `dependencies` entry is a
copy the module brings with it, and two modules pinning two different exact versions
can never dedupe to one.

`@stonyx/discord` is the reference implementation. From
`npm view @stonyx/discord@0.1.1-beta.117` on 2026-09-05 — the version, not the tag,
because the `beta` tags below move several times a day:

```json
{
  "devDependencies": { "stonyx": "0.2.3-beta.96" },
  "peerDependencies": { "stonyx": ">=0.2.3-beta.4" }
}
```

Measured on 2026-09-05, one application manifest with `stonyx` at `0.2.3-beta.96` in
`dependencies`, one module swapped, `pnpm install` each time. Modules are named at the
version that resolved, since the `@beta` form of the second row stopped reproducing
within a day of being written:

| module in `devDependencies` | its `stonyx` declaration | distinct cores resolved |
|---|---|---|
| `@stonyx/discord@0.1.1-beta.117` | `devDependencies` + non-optional peer | **1** — `0.2.3-beta.96` |
| `@stonyx/sockets@0.1.1-beta.48` | `dependencies: "0.2.3-beta.62"` | **2** — `0.2.3-beta.62`, `0.2.3-beta.96` |
| `@stonyx/sockets@0.1.1-beta.49` | `dependencies: "0.2.3-beta.96"` | **1** — `0.2.3-beta.96` |

The last two rows are the same module one publish apart, and they are the point of the
rule: a `dependencies` declaration dedupes only when its pin happens to equal the
application's core.

**The peer range must not be optional.** `peerDependenciesMeta.stonyx.optional = true`
tells the installer the peer may be absent, which turns a missing core from an install
error into a runtime one. `@stonyx/discord` declares no `peerDependenciesMeta` entry
for `stonyx`. (Optional peers are appropriate for *other* modules a module can work
without — `@stonyx/orm` marks `@stonyx/rest-server` optional for exactly that reason —
never for the core.)

Modules still out of compliance as of 2026-09-05, each declaring `stonyx` in
`dependencies` at an exact version rather than in `devDependencies` plus a peer range,
given at the version that resolved:

| module, resolved | its `dependencies.stonyx` |
|---|---|
| `@stonyx/cron@0.2.1-beta.132` | `0.2.3-beta.96` |
| `@stonyx/oauth@0.1.1-beta.197` | `0.2.3-beta.96` |
| `@stonyx/orm@0.3.2-beta.249` | `0.2.3-beta.96` |
| `@stonyx/rest-server@0.2.1-beta.133` | `0.2.3-beta.96` |
| `@stonyx/sockets@0.1.1-beta.49` | `0.2.3-beta.96` |

Tracked in abofs/stonyx#106 and abofs/stonyx#108. Re-derive that column with
`npm view <pkg>@beta version dependencies.stonyx` rather than trusting it: every one of
these numbers has moved since it was first written, and four of the five moved on the
day they were.

**A partial rollout is observable in the core COUNT, one module at a time — but not in
the boot outcome.** Each module's compliance is independent, so every module that ships
the rule removes one potential copy, with no wait for the other four. The boot outcome
is not incremental: since abofs/stonyx#108 `loadModules` refuses to start while any
discovered module resolves a second core, so one non-compliant module with a skewed pin
refuses the whole application regardless of how many siblings have complied. Count
copies to see progress; do not expect a partial rollout to make an application boot.

An application also benefits, accidentally and temporarily, whenever a non-compliant
module's pin happens to equal its own core — which is the state of all five above,
measured 2026-09-05: an application pinning `stonyx@0.2.3-beta.96` resolves exactly one
core with any of them installed. That is not the rule working. It is the rule not being
needed this hour, and it reverts the next time the core publishes ahead of the modules.

Consumer-side guidance, and the command that counts copies, is in
[Modules — Version alignment](../modules.md#version-alignment).

## Module `config/environment.js` is always JavaScript

Every `@stonyx/*` module that exposes default configuration does so through `config/environment.js`. This file is a **consumer contract**, not implementation code.

- Node's type-strip loader refuses to process `.ts` files inside `node_modules`, so a module shipping a `.ts` config cannot be loaded by any consumer, whatever the loader supports.
- This is a **runtime** constraint, not a loader one. `importConfig` resolves `config/environment.ts` then `config/environment.js` for *any* base path (see [Configuration](../configuration.md#environment-config)); it is Node that refuses the file once it sits under `node_modules`.
- A module that ships `config/environment.ts` therefore fails, and **the thrown error says so** — measured end-to-end through `loadModules` (the only production path for module configs):
  - The error the caller and any supervisor receives is `Stonyx module "@stonyx/<name>" ships default configuration this Node runtime declined to load. Config present but not loadable: …/config/environment.ts exists, but this Node runtime refused to load it (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING): …`, and `error.cause` is `importConfig`'s own error.
  - It is **not** byte-identical to the no-config case any more; a module shipping no config at all reports `carries the "stonyx-async" keyword, which requires it to ship default configuration, and none is installed`, naming both paths it looked for.
  - Nothing is written to stderr behind the caller. The bare `console.error(error)` that used to carry the only accurate account of the failure is gone, because the thrown error now carries it (abofs/stonyx#108).

  *What this does not cover:* the message names which **step** failed and reproduces the underlying error verbatim. It does not diagnose why a module's own config threw, and it cannot tell a module that ships no config from one whose install was truncated.

TS-migration PRs in `@stonyx/*` modules **must** skip `config/environment.*` — leave it as `.js`. If you find a module shipping `config/environment.ts`, that is a P0 consumer crash; rename it back to `.js` immediately.

> **Fixed by abofs/stonyx#108.** Two facts were measured against `src/modules.ts:116-119` before that change and are recorded here because the fix is what a future reader has to keep true, and a mutation that undoes either one restores a state the framework shipped for months:
> 1. `importConfig`'s "present but not loadable" distinction **did not survive end-to-end on the module path**. It was produced correctly by the loader and then discarded by a single relabel; a fixture shipping `config/environment.ts` and a fixture shipping no config at all threw the same string. `CONFIG_NOT_LOADABLE_PREFIX` was exported for this branch and had no non-test importer in `src/`.
> 2. **The rethrow carried no `cause`**, so a supervisor that caught it lost the original error entirely.
>
> Both are guarded by `test/unit/modules-test.ts` ("a module shipping config/environment.ts throws a DIFFERENT, causal error from one with no config") and `test/unit/module-load-failure-test.ts`.

## Module README, sample and type conventions

These apply to every `@stonyx/*` module repo. Where the module READMEs differed, the majority form on their `dev` branches (measured 2026-10-24) was chosen.

**Sample pointer: a `## Samples` section.** It links `test/sample/` on GitHub, says the samples are not in the npm package, and names the tests that run them. Where a module answers common questions, it adds a **How do I… / Sample** table, as stonyx-rest-server does. Six READMEs use this heading (cron, discord, oauth, orm, rest-server, sockets); events and utils use `## Canonical usage`.

**Exports: a `## Exports` table** with one row per `package.json#exports` key, in this form:

```md
| Import path | What it exports |
| :--- | :--- |
| `@stonyx/<name>` | `<Name>` (default), ... |
```

Say what is a default export and what is named, as the cron, orm and rest-server READMEs do. Those three use exactly this header. The others differed: `Import | Provides` (discord), `Import | Exports` (oauth, and stonyx core before this change), `Import path | Exports` (utils), `Import | Export` under `## Entry points` (logs), a bullet list (sockets), and no exports section at all (events). `Import path` is the first column in 4 of the 7 module tables, and `What it exports` the second column most often used (3 tables).

**`@types/*` goes in `dependencies` when the published types need it.** If a module's emitted `.d.ts` files import types from another package, that package's `@types/*` is a `dependency`, not a `devDependency`, or TypeScript consumers get implicit-`any` errors. stonyx-rest-server's `dist/*.d.ts` import from `express`, so `@types/express` moved to `dependencies` in abofs/stonyx-rest-server#81, which measured it: a fresh strict consumer type-checking the copied samples got 6 errors (`TS7006`) before the move and none after. To find a module's candidates, build it and list the bare specifiers its `dist/*.d.ts` import.

**The sample-surface guard from `@stonyx/events` is the standard test for `test/sample/`.** [`test/unit/sample-surface-test.ts`](https://github.com/abofs/stonyx-events/blob/dev/test/unit/sample-surface-test.ts) (abofs/stonyx-events#29) fails when an `exports` subpath stops resolving to the built entry, when a runtime export is imported by no sample, when a sample is imported by no `*-test.ts`, or when a sample imports something a consumer cannot write (an unexported subpath, or a relative path out of `test/sample/`). It reads the package from the working directory, so it is copied unchanged: stonyx-utils carries a byte-identical copy (`cmp` exit 0). It collects `.ts` sample files only, so a module with `.js` samples (stonyx-discord) has to widen that filter when it adopts the guard. The narrower `test/unit/sample-imports-test.ts` in stonyx-discord, stonyx-oauth and stonyx-rest-server checks only the last of the four.

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
- `forEachFileImport(dir, callback, options?)` — iterate and dynamically import every `.js` and `.ts` file in a directory
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

### Fuzzy matching (`@stonyx/utils/fuzzy-match`)

- default export `FuzzyMatch` class: `new FuzzyMatch(options?)`, then `normalize(name)`, `similarity(nameA, nameB)`, `findBestMatch(nameA, nameB, entries, threshold?)`

File issues on `stonyx-utils` for any gaps rather than adding workarounds or npm dependencies.

**Reference to copy:** `test/sample/` in [abofs/stonyx-utils](https://github.com/abofs/stonyx-utils/tree/dev/test/sample), one file per import path (`file.ts`, `object.ts`, `string.ts`, `date.ts`, `promise.ts`, `prompt.ts`, `fuzzy-match.ts`). The test suite runs them against the built package.

## `@stonyx/events`

All pub/sub event handling. Never create custom event emitters.

- `setup(eventNames)` — register valid event names
- `subscribe(event, callback)` — listen for events
- `once(event, callback)` — single-fire listener
- `unsubscribe(event, callback)` — remove listener
- `emit(event, ...args)` — fire event
- `clear(event)` / `reset()` — cleanup

**Reference to copy:** [`test/sample/convenience.ts`](https://github.com/abofs/stonyx-events/blob/dev/test/sample/convenience.ts) (the functions above) and [`test/sample/class.ts`](https://github.com/abofs/stonyx-events/blob/dev/test/sample/class.ts) (the default-export `Events` class) in abofs/stonyx-events.

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

See [Cron Conventions](./cron-conventions.md) for full details. **Reference to copy:** [`test/sample/payload.ts`](https://github.com/abofs/stonyx-cron/blob/dev/test/sample/payload.ts) in abofs/stonyx-cron.

Configurable via `config/environment.js`:

```js
export default {
  cron: { log: true }
}
```

## `@stonyx/sockets`

WebSocket handlers, one class per file in `socket-handlers/` (config `sockets.handlerDir`). Class ordering: static properties → `server` hook → `client` hook.

Exports (the root re-exports the three classes as named exports; each also has its own subpath):

```js
import Sockets, { SocketServer, SocketClient, Handler } from '@stonyx/sockets';
```

or, one class per subpath:

```js
import SocketServer from '@stonyx/sockets/server';
import SocketClient from '@stonyx/sockets/client';
import Handler from '@stonyx/sockets/handler';
```

The root, `@stonyx/sockets/server` and `@stonyx/sockets/client` throw `Stonyx has not been initialized yet` when imported outside a booted Stonyx app; `@stonyx/sockets/handler` loads anywhere. The same holds for most `@stonyx/*` package roots: see [Standalone scripts are the exception](./index.md#standalone-scripts-are-the-exception).

**Reference to copy:** [`test/sample/socket-handlers/echo.ts`](https://github.com/abofs/stonyx-sockets/blob/dev/test/sample/socket-handlers/echo.ts) and [`auth.ts`](https://github.com/abofs/stonyx-sockets/blob/dev/test/sample/socket-handlers/auth.ts) in abofs/stonyx-sockets. They import `Handler` from `@stonyx/sockets/handler`, and the integration tests run against them.

## `@stonyx/discord`

Discord bot with command and event handler auto-discovery. Class ordering: static properties → `data` / `static event` → `execute()` / `handle()`.

Exports (each from its own subpath; the root exports only `Discord`):

```js
import Discord from '@stonyx/discord';
import DiscordBot from '@stonyx/discord/bot';
import Command from '@stonyx/discord/command';
import EventHandler from '@stonyx/discord/event-handler';
import { chunkMessage } from '@stonyx/discord/message';
import { SlashCommandBuilder } from '@stonyx/discord/base';
```

**Reference to copy:** the Quick Start in the `@stonyx/discord` README (shipped in the package), and the samples under `test/sample/` in abofs/stonyx-discord ([online](https://github.com/abofs/stonyx-discord/tree/dev/test/sample), with repository access). See [Discord Conventions](./discord-conventions.md).

## `@stonyx/oauth`

OAuth providers. A custom provider extends the default export of `@stonyx/oauth/oauth-flow`. Class ordering: constructor with `super()` → async methods → transform methods.

Exports:

```js
import OAuth, { STATE_TTL_MS, BINDING_VALUE_BYTES } from '@stonyx/oauth';
import OAuthFlow from '@stonyx/oauth/oauth-flow';
import AuthRequest from '@stonyx/oauth/auth-request';
import SessionManager from '@stonyx/oauth/session-manager';
import TokenManager from '@stonyx/oauth/token-manager';
import DiscordProvider from '@stonyx/oauth/providers/discord';
```

`@stonyx/oauth` and `@stonyx/oauth/auth-request` import `stonyx/log` (the root also `stonyx/config`), so they can only be imported inside a booted Stonyx app, like most `@stonyx/*` package roots (see [Standalone scripts are the exception](./index.md#standalone-scripts-are-the-exception)). Key methods of the `OAuth` singleton: `getAuthorizationUrl()`, `handleCallback()`, `getSession()`, `logout()`.

**Reference to copy:** [`test/sample/providers/mock.ts`](https://github.com/abofs/stonyx-oauth/blob/dev/test/sample/providers/mock.ts) in abofs/stonyx-oauth, a custom provider built on `@stonyx/oauth/oauth-flow`.

OAuth discovers no directory. It loads one provider per key of `oauth.providers`, from that entry's `module` path, resolved against the project root. Without `module`, it looks for a built-in provider of that name inside the package (only `discord` exists), so a file in your own `providers/` directory that no config entry names is never loaded. Register a custom provider like this:

```js
// config/environment.js
export default {
  oauth: {
    providers: {
      acme: {
        clientId: process.env.ACME_CLIENT_ID,
        clientSecret: process.env.ACME_CLIENT_SECRET,
        redirectUri: process.env.ACME_REDIRECT_URI,
        scopes: ['identify'],
        module: './providers/acme.js'
      }
    }
  }
};
```

The module's test config does the same for its sample: `oauth.providers.mock.module` is `'./test/sample/providers/mock.ts'`.

## `@abofs/code-conventions`

Shared lint and formatting config. Import and spread; never define local rules.

Exports:
- `@abofs/code-conventions/eslint` — ESLint config
- `@abofs/code-conventions/prettier` — Prettier config
- `@abofs/code-conventions/eslint-ember` — Ember-specific ESLint
- `@abofs/code-conventions/template-lint` — Template linting
- `@abofs/code-conventions/lint-staged` — Lint-staged config
