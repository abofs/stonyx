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

> Read [Version alignment](#version-alignment) before you add modules. A module that
> declares its own `stonyx` at a version other than yours puts a second core in the
> tree, and `stonyx serve` refuses to start until there is one core — sync module or
> async module, imported or not.
>
> Measured 2026-09-05 against an application pinning `stonyx@0.2.3-beta.96`, one
> module at a time: every module at `@beta` resolved exactly **one** core, and
> `@stonyx/cron`, `@stonyx/discord`, `@stonyx/events`, `@stonyx/rest-server` and
> `@stonyx/sockets` booted. `@stonyx/orm@0.3.2-beta.249` and
> `@stonyx/oauth@0.1.1-beta.197` exit 1, but on an unsatisfied *sibling* module
> (`@stonyx/rest-server`), not on a duplicate core — see abofs/stonyx-orm#291. The
> module `beta` tags move several times a day, so count rather than assume.

### Why not `latest`

Measured 2026-09-05:

- `stonyx@latest` is `0.2.2` while `stonyx@beta` is `0.2.3-beta.96`. `0.2.2` ships no
  `bin` field, so a project that resolves it has **no `node_modules/.bin/stonyx`** and
  its own `"serve": "stonyx serve"` script has no binary to run.
- Each module's `latest` tag points at a release that pins an older core:
  `@stonyx/sockets@latest` (`0.1.0`) pins `stonyx@0.2.3-beta.6`, and
  `@stonyx/orm@latest` (`0.3.1`) declares `stonyx@0.2.3-beta.11` directly in its own
  `dependencies` (its `@stonyx/cron@0.2.1-beta.29` pins the same core, but that is an
  additional path, not the route).

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

**And do not wait for an error — but as of abofs/stonyx#108 there will be one.**
Before that change, whether a second core was loud or silent followed the module's
`stonyx-async` keyword, because `loadModules` skips the import entirely for a module
without it and an unimported copy never complains. That is no longer the mechanism.

`loadModules` now runs a **pre-flight** before any module entry point is imported:
every discovered `@stonyx/*` module carrying the `stonyx-module` keyword must resolve
the same physical `stonyx` package root as the running core, or the boot is refused
with a diagnostic naming every path and every version. The keyword still decides
whether the module is *imported*; it no longer decides whether a duplicate core is
noticed, because the pre-flight runs first and reads neither arm's keyword.

Why the check had to move in front of the import: a sync module is never imported by
the loader, so its second singleton was invisible — it loaded nothing, complained
about nothing, and registered its hooks on a core nobody started only once the
application's own code imported it. The failure it produced was real and arrived
somewhere else entirely, which is what abofs/stonyx#108 was filed over.

Re-measured 2026-09-05 at `fix/108-duplicate-core`, against `origin/dev` `8ca078f` as
the control, in a hand-built two-file consumer pinning the core it ships. One fixture
module, six trees, and **the only variables are the keyword set, the number of cores
on disk, and whether `app.js` imports the module**. `stonyx serve` in each; exit code
read from the process, not from a pipe tail:

| module keywords | cores | `app.js` imports it | `dev` `8ca078f` | this branch |
|---|---|---|---|---|
| `stonyx-module` | 1 | no | `BOOT_OK`, exit **0** | `BOOT_OK`, exit **0** |
| `stonyx-module` | 2 | no | `BOOT_OK`, exit **0**, no warning | exit **1**, duplicate-core refusal |
| `stonyx-module` | 2 | yes | exit **1**, `Stonyx has not been initialized yet` | exit **1**, duplicate-core refusal |
| `stonyx-module`, `stonyx-async` | 1 | no | `BOOT_OK`, exit **0** | `BOOT_OK`, exit **0** |
| `stonyx-module`, `stonyx-async` | 2 | no | exit **1**, relabelled config message | exit **1**, duplicate-core refusal |
| `stonyx-module`, `stonyx-async` | 2 | yes | exit **1**, relabelled config message | exit **1**, duplicate-core refusal |

The one-core rows are the control: they boot on both, so the four refusals are the
second core and not the harness.

**Read the `dev` column for what the keyword used to buy, and the last column for what
it buys now: nothing.** Every two-core row on this branch fails identically, from
`loadModules`, before the module is imported:

```
Error: Stonyx: 2 copies of the framework are installed and this app cannot be served.

  running core                  0.2.3-beta.97  <app>/node_modules/stonyx
  seen by "@stonyx/<name>"      0.0.0-dup      <app>/node_modules/@stonyx/<name>/node_modules/stonyx

Config, logging and lifecycle hooks are registered on the running core. "@stonyx/<name>"
imports a different copy, so for it `Stonyx.config` is empty, `Stonyx.log` throws
"Stonyx has not been initialized yet", and its startup and shutdown hooks never fire.
    at loadModules (<app>/node_modules/stonyx/dist/modules.js)
```

What the `dev` column shows, for anyone reading an older report: a sync module with a
skewed pin booted clean and exited 0, and only turned into
`Error: Stonyx has not been initialized yet` — thrown from the module's own copy of
`dist/main.js`, arriving through the app-entry import and never through `loadModules`
— once one line was added to `app.js`. An async module always exited 1, with its real
cause written to stderr through a side channel and the thrown error relabelled
`Stonyx modules with async loading must have a config/environment.js file with default
configurations. Module "<name>" failed to load.` — a message wrong about both the file
and the module. Both of those behaviours are gone; the message no longer exists.

**Two limits of the pre-flight, so absence of a refusal is still not proof.** It only
looks at `@stonyx/*` packages in the application's `devDependencies` that carry the
`stonyx-module` keyword, and it compares physical package roots rather than version
ranges. A copy dragged in by anything else is not counted, and it fails **open** —
an unreadable or unparseable manifest, or a running core that cannot identify itself,
produces a `console.warn` naming the probe and no refusal.

Absence of an error is not evidence of a single core. Count.

> **Known issue (2026-09-05).** Five modules — `@stonyx/cron`, `@stonyx/oauth`,
> `@stonyx/orm`, `@stonyx/rest-server` and `@stonyx/sockets` — declare `stonyx` in
> their own `dependencies` at an exact version rather than `devDependencies` plus a
> peer range. Whether that adds a second core depends entirely on what the application
> declares: a module pin equal to the application's core dedupes to one, and a pin at
> any other version does not. Measured 2026-09-05, all five resolved
> `stonyx@0.2.3-beta.96` on their `beta` tag and deduped onto an application pinning
> the same, while `@stonyx/sockets@0.1.1-beta.48` — the `beta` tag the day before —
> pinned `0.2.3-beta.62` and resolved two. The declaration is still wrong: it makes
> deduping a coincidence of release timing rather than a property of the manifest.
> `@stonyx/discord` is the one module with the correct shape (see
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
