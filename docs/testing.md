# Testing

Stonyx includes built-in test infrastructure using [QUnit](https://qunitjs.com/).

## Running Tests

```bash
stonyx test                     # Runs test/**/*-test.js by default
stonyx test "test/unit/**/*.js" # Custom glob pattern
```

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
