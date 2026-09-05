# Testing Conventions

## Directory Structure

```
test/
  unit/
  integration/
  acceptance/
  config/
    environment.ts    # test config overrides (.js also supported)
  sample/             # fixtures and mocks (alternative: test/mocks/)
```

## File Naming

All test files use the `*-test.js` suffix: `animal-test.js`, `public-request-test.js`.

## Test Framework

- **QUnit** — test framework
- **Sinon** — stubs, spies, and mocks

Run tests with `stonyx test` (alias: `stonyx t`), which:
1. Sets `NODE_ENV=test`
2. Loads test setup (bootstrap with test config overrides)
3. Runs QUnit against `test/**/*-test.js`

## Test Config Overrides

Place test-specific config at `test/config/environment.ts` (or `.js`). Stonyx auto-merges these overrides when running in test mode.

## Sample / Fixture Files

Each stonyx module's `test/sample/` directory contains reference implementations. Mirror this structure in your project tests:

- `test/sample/models/` — model fixtures
- `test/sample/serializers/` — serializer fixtures
- `test/sample/access/` — access control fixtures
- `test/sample/transforms/` — transform fixtures
- `test/sample/requests/` — request handler fixtures

The file ordering in tests should mirror the sample files from each module's `test/sample/` directory.

## Running Tests

```bash
# Run all tests
stonyx test

# Run specific test file
stonyx test test/unit/animal-test.js

# Run specific glob
stonyx test "test/integration/**/*-test.js"
```
