# Module System

Stonyx uses a plug-and-play module architecture. Modules are automatically detected, loaded, and initialized at startup.

## Installing Stonyx in an Application

`stonyx new` generates this shape for you. If you are adding Stonyx to an existing
project, match it.

- **The core goes in `dependencies`.** `stonyx` is a runtime dependency of the
  application: the `stonyx` binary runs your app and your `app.ts` imports from it.
- **`@stonyx/*` modules go in `devDependencies`.** That is where the loader scans
  (see [How Modules Are Discovered](#how-modules-are-discovered)).
- **Pin the core to an exact version**, and request every module from the core's own
  release line. Never `latest` for the core — see [Why not `latest`](#why-not-latest).

A minimal application. This manifest was installed into a fresh directory alongside
a minimal `app.ts` and `config/environment.ts` and booted on 2026-09-05 — `stonyx
serve` printed the app's log line and the process exited 0:

```json
{
  "name": "my-app",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": { "serve": "stonyx serve" },
  "dependencies": { "stonyx": "0.2.3-beta.96" }
}
```

Use the version of `stonyx` you are actually installing, not the one printed above.
`npm view stonyx dist-tags` shows the current tip of each release line.

Adding modules keeps the same shape — each module requested at the dist-tag of the
core's release line, so the whole set stays on one line:

```json
{
  "dependencies": { "stonyx": "0.2.3-beta.96" },
  "devDependencies": { "@stonyx/orm": "beta", "@stonyx/sockets": "beta" }
}
```

> Read [Version alignment](#version-alignment) before you add modules. As of
> 2026-09-05 the published modules still pull in their own copy of the core, and a
> project that installs them will not boot.

### Why not `latest`

Measured 2026-09-05:

- `stonyx@latest` is `0.2.2` while `stonyx@beta` is `0.2.3-beta.96`. `0.2.2` ships no
  `bin` field, so a project that resolves it has **no `node_modules/.bin/stonyx`** and
  its own `"serve": "stonyx serve"` script has no binary to run.
- Each module's `latest` tag points at a release that pins an older core:
  `@stonyx/sockets@latest` (`0.1.0`) pins `stonyx@0.2.3-beta.6`, and
  `@stonyx/orm@latest` (`0.3.1`) reaches `stonyx@0.2.3-beta.11` through `@stonyx/cron`.

A manifest asking for `latest` for the core plus `@stonyx/rest-server`,
`@stonyx/sockets` and `@stonyx/orm` resolved to **three** distinct cores — `0.2.2`,
`0.2.3-beta.6` and `0.2.3-beta.11` — under stock `pnpm install` with no `.npmrc` and
no overrides.

Note what this is *not*: `pnpm` resolved the root's own `latest` to `0.2.2`, exactly
what the tag means. Every extra copy arrived transitively, from a pin inside a
published module. Pinning the application's core does not remove them.

### Version alignment

An application must resolve exactly **one** copy of `stonyx`. Check it:

```sh
pnpm why stonyx      # or, under npm:  npm ls stonyx --all
```

Every `stonyx x.y.z` line in the output must show the same version. For just the
distinct versions:

```sh
pnpm why stonyx --json | node -e '
  let raw = ""; process.stdin.on("data", d => raw += d).on("end", () => {
    const seen = new Set();
    const walk = (deps) => { for (const dep of Object.values(deps || {})) {
      if (dep.from === "stonyx") seen.add(dep.version);
      walk(dep.dependencies);
    } };
    for (const p of JSON.parse(raw)) { walk(p.dependencies); walk(p.devDependencies); walk(p.optionalDependencies); }
    console.log([...seen].sort().join("\n") || "(no stonyx resolved)");
  });'
```

More than one line is this defect.

Three details of that walk are load-bearing, each measured against a tree built to
break the obvious version of it:

- **Key on `dep.from`, not on the tree key.** The tree key is the *alias*, not the
  package. A manifest declaring both `"stonyx": "0.2.3-beta.96"` and
  `"legacy-core": "npm:stonyx@0.2.2"` installs both cores — `ls node_modules/.pnpm`
  shows `stonyx@0.2.2` and `stonyx@0.2.3-beta.96` — and a walk matching
  `name === "stonyx"` reports **1**. Matching `dep.from === "stonyx"` reports 2.
- **Walk `optionalDependencies` too.** `pnpm why --json` emits the project's own
  `optionalDependencies` as a separate top-level key. A core declared there is missed
  entirely by a walk that reads only `dependencies` and `devDependencies` — measured
  reporting **0**. (Transitive optional deps are flattened into `dependencies` and
  were already counted.)
- **Say something when nothing is found.** Without the `|| "(no stonyx resolved)"`
  fallback the miss above prints a single blank line, which reads as "clean" under
  *more than one line is this defect*. Zero cores and one core are not the same
  answer, and neither should be silent.

**Do not count directories.** `find node_modules -type d -name stonyx` also matches
store entries `pnpm` leaves behind from an earlier install — measured reporting two
versions in a project that resolves exactly one. `pnpm why` walks the resolved graph
and does not.

**And do not wait for an error.** Two cores produce either outcome, both measured on
2026-09-05 in a two-file consumer:

- **Loud.** With `@stonyx/sockets`, `stonyx serve` exits 1 with
  `Error: Stonyx has not been initialized yet`, thrown from the *module's* copy of the
  core under `node_modules/.pnpm/stonyx@0.2.3-beta.62/`, then relabelled as
  `Stonyx modules with async loading must have a config/environment.js file with
  default configurations. Module "@stonyx/sockets" failed to load.` The config file
  that second message points at is present and correct — the message is wrong about
  the cause (see abofs/stonyx#108).
- **Silent.** With `@stonyx/cron`, the same two-core tree booted, printed the app's
  log line and exited 0, with no warning of any kind.

Absence of an error is not evidence of a single core. Count.

> **Known issue (2026-09-05).** Five modules — `@stonyx/cron`, `@stonyx/oauth`,
> `@stonyx/orm`, `@stonyx/rest-server` and `@stonyx/sockets` — declare `stonyx` in
> their own `dependencies` at an exact version, so installing any of them today adds a
> core copy no matter what the application declares. `@stonyx/discord` is the one
> module with the correct shape (see
> [Framework Modules](conventions/framework-modules.md#a-module-never-declares-stonyx-in-dependencies)).
> Tracked in abofs/stonyx#108 and abofs/stonyx#106; the fix is in the modules, not in
> your application.

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
| [@stonyx/discord](https://github.com/abofs/stonyx-discord) | Discord bot with command and event handler auto-discovery |
| [@stonyx/events](https://github.com/abofs/stonyx-events) | Pub/sub event system |
| [@stonyx/oauth](https://github.com/abofs/stonyx-oauth) | OAuth provider integration |
| [@stonyx/orm](https://github.com/abofs/stonyx-orm) | ORM with models, relationships, serializers, and optional REST integration |
| [@stonyx/rest-server](https://github.com/abofs/stonyx-rest-server) | Dynamic REST server with auto-route registration |
| [@stonyx/sockets](https://github.com/abofs/stonyx-sockets) | WebSocket server and client |

See each module's repository for its specific documentation.
