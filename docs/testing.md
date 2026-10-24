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

Create `test/config/environment.ts` (or `.js`) to override configuration during tests:

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

## Booting Stonyx More Than Once in One Process

`Stonyx` is a process-global singleton. Once an instance exists, `new Stonyx(...)` returns that first instance and ignores the new config, and `Stonyx.initialized` stays `true`. A test file that boots Stonyx twice in-process will therefore assert every later case against the first boot's config unless it resets the singleton between boots:

```ts
import Stonyx from 'stonyx';

hooks.afterEach(() => {
  // `Stonyx.instance` is typed non-optional; the cast keeps this valid under `strict`.
  Stonyx.instance = undefined as unknown as Stonyx;
  Stonyx.initialized = false;
  Stonyx.modulePromises = {};
});
```

In a `.js` test file, drop the `as unknown as Stonyx` cast.

With that teardown, two successive in-process boots produce distinct configs on `Stonyx.config`. `Stonyx.modulePromises` is reset for completeness only: the registry `waitForModule` reads is module-level state inside `src/modules.ts`, which this teardown does not touch. `loadModules` rebuilds the entry for each `@stonyx/*` dependency on every boot.

The teardown does not reach `stonyx/config` or `stonyx/log`. Each binds its default export once, when it is first imported, so after a reboot both still hold the first boot's config and logger. Read `Stonyx.config` and `Stonyx.log` directly in a test that reboots.

Running each boot in its own subprocess is stronger: it also isolates `process.env` and the ESM module registry (so `stonyx/config` and `stonyx/log` bind afresh), and it does not depend on a teardown being called. `test/unit/standalone-transform-test.ts` uses that approach, through `test/helpers/boot-stonyx.ts`.
