# Testing

Stonyx includes built-in test infrastructure using [QUnit](https://qunitjs.com/).

## Running Tests

```bash
stonyx test                     # Runs test/**/*-test.{js,ts} by default
stonyx test "test/unit/**/*.js" # Custom glob pattern
```

The default glob matches both `.js` and `.ts` test files, so TypeScript test suites run without any CLI argument.

The test command:
1. Sets `NODE_ENV=test`
2. Bootstraps Stonyx via a `--require` setup file
3. Applies [test config overrides](configuration.md#test-environment-overrides)
4. Runs QUnit with the specified glob

## Test Config Overrides

Create `test/config/environment.js` to override configuration during tests:

```js
export default {
  debug: false,
  restServer: { port: 0 },
};
```

These are deep-merged into the main config. See [Configuration](configuration.md#test-environment-overrides).

## Integration Test Helper

For tests that need Stonyx fully initialized (e.g., testing modules with database connections):

```js
import { setupIntegrationTests } from 'stonyx/test-helpers';

const { module, test } = QUnit;

module('My Integration Test', function(hooks) {
  setupIntegrationTests(hooks);

  test('can access modules', function(assert) {
    // Stonyx is fully initialized here
    assert.ok(true);
  });
});
```

`setupIntegrationTests` adds a `before` hook that waits for `Stonyx.ready` to resolve.

## Test File Convention

Place tests under `test/` with the `-test.js` suffix:

```
test/
  unit/
    my-feature-test.js
    cli/
      serve-test.js
  integration/
    api-test.js
```

## Fresh-Clone Scaffold Acceptance Harness

`test/acceptance/fresh-clone-scaffold-test.ts` runs the whole `stonyx new`
lifecycle end to end: `rm -rf dist && pnpm build && npm pack`, generate a
project, commit it, `git clone` it to a **second** directory, then install the
packed tarball, build, serve and boot — asserting only in the clone.

```bash
pnpm test:acceptance
```

It is excluded from `pnpm test` (it performs a real `pnpm install`) and gated
behind `STONYX_ACCEPTANCE=1`. A dedicated CI job runs it on every PR touching
`src/cli/new.ts`, `src/util/import-config.ts`, `src/main.ts`,
`scripts/postinstall.js` or the harness itself.

### Why the second directory

Several defects tracked on [#88](https://github.com/abofs/stonyx/issues/88)
are **invisible from the directory where the scaffold ran**. The generated
project's `.gitignore` carries `*.js` and `*.d.ts` to keep in-place `tsc`
output untracked, and that rule also swallows hand-authored source files the
project mandates elsewhere. Those files exist locally and are merely untracked,
so lint, typecheck and the suite are all green on the author's machine and
absent in CI. Only a clone shows it.

### Three vacuity traps it is built around

Each was verified by execution, not by reasoning. Anything asserting on this
lifecycle has to handle all three or it can report green while the defect is
fully live.

| trap | why the obvious check is vacuous | what the harness does |
|---|---|---|
| `git check-ignore` is index-aware | it reports "not ignored" for any tracked path, so it goes green with `*.js` fully live — and in a fresh clone of a fixed repo the file is always tracked, so it cannot fail there at all | `--no-index`, paired with `git ls-files`; each catches a different regression |
| a stale `dist/` | a `dist/util/import-config.js` predating `4c80c87` still resolves `.ts` configs, producing a green run of the central assertion from a build artifact | `rm -rf dist && pnpm build && npm pack` in the same run, installing that tarball and never a workspace link |
| tsx rewrites `.js` to a `.ts` sibling | importer-dependent: from a `.ts` importer, `import(pathToFileURL('…/cfg.js'))` yields `cfg.ts`; from a `.js` importer inside `node_modules` it does not | asserts no `.ts`/`.js` sibling pair exists at the override base path |

### Mutation proof

`STONYX_ACCEPTANCE_CONTROL` hand-patches the throwaway generated project so
each assertion can be observed going green. It is evidence, not a fix — it
touches nothing in this repo and no normal run applies it.

```bash
STONYX_ACCEPTANCE_CONTROL=fixed   pnpm test:acceptance   # expect all green
STONYX_ACCEPTANCE_CONTROL=swallow pnpm test:acceptance   # expect clone parity to fail
```
