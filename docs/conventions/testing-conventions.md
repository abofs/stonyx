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

Test files use the `*-test.js` or `*-test.ts` suffix: `animal-test.js`, `public-request-test.ts`. `stonyx test` with no arguments runs `test/**/*-test.{js,ts}`; a file without the suffix is not run.

## Test Framework

- **QUnit** — test framework
- **Sinon** — stubs, spies, and mocks

Run tests with `stonyx test` (alias: `stonyx t`), which:
1. Sets `NODE_ENV=test`
2. Loads test setup (bootstrap with test config overrides)
3. Runs QUnit against `test/**/*-test.{js,ts}` (or the files and globs you pass)

## Test Config Overrides

Place test-specific config at `test/config/environment.ts` (or `.js`). Stonyx auto-merges these overrides when running in test mode.

## Sample / Fixture Files

Each stonyx module's `test/sample/` directory holds the reference implementations its own test suite loads. They are the code to copy, and the layout to mirror in your project's tests. Modules that discover files (ORM, REST server, Discord, sockets, OAuth) point their test config at these directories:

| Module | `test/sample/` contents |
|---|---|
| [`@stonyx/orm`](https://github.com/abofs/stonyx-orm/tree/dev/test/sample) | `models/`, `serializers/`, `access/`, `transforms/`, `views/`, `db-schema.ts`, `constants.ts` |
| [`@stonyx/rest-server`](https://github.com/abofs/stonyx-rest-server/tree/dev/test/sample/requests) | `requests/` (with a base class in `requests/base/`) |
| `@stonyx/discord` (abofs/stonyx-discord, private) | `discord-commands/`, `discord-events/`, `scripts/deploy-commands.js` |
| [`@stonyx/sockets`](https://github.com/abofs/stonyx-sockets/tree/dev/test/sample/socket-handlers) | `socket-handlers/` |
| [`@stonyx/oauth`](https://github.com/abofs/stonyx-oauth/tree/dev/test/sample/providers) | `providers/` (a custom provider) |
| [`@stonyx/cron`](https://github.com/abofs/stonyx-cron/blob/dev/test/sample/payload.ts) | `payload.ts` (job definitions) |
| [`@stonyx/events`](https://github.com/abofs/stonyx-events/tree/dev/test/sample) | `convenience.ts`, `class.ts` |
| [`@stonyx/utils`](https://github.com/abofs/stonyx-utils/tree/dev/test/sample) | one file per import path |

The samples are not in the npm packages. Most are TypeScript; see [REST Conventions](./rest-conventions.md) for how to copy one as JavaScript.

## Running Tests

```bash
# Run all tests
stonyx test

# Run specific test file
stonyx test test/unit/animal-test.ts

# Run specific glob
stonyx test "test/integration/**/*-test.ts"
```
