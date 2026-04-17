# Configuration

Stonyx uses a centralized configuration file that all modules read from at startup.

## Environment Config

Your project's configuration lives at `config/environment.ts` (preferred) or `config/environment.js`:

```ts
const { DEBUG, NODE_ENV } = process.env;

const environment = NODE_ENV ?? 'development';

export default {
  environment,
  debug: DEBUG ?? environment === 'development',

  // Module-specific configuration
  restServer: { logColor: 'yellow', port: 3000 },
  cron: { log: true },
};
```

Stonyx resolves the config by trying `.ts` first, then falling back to `.js`. If both are present `.ts` wins and a warning is logged — the `.js` is almost always a stale compiled artifact or postinstall stub and should be removed.

The `.js` template is auto-generated on `npm install` via the postinstall script if neither extension exists yet.

> **Note:** `config/environment.*` is gitignored by default so each environment can have its own settings.

## Module Configuration

Each Stonyx module reads its configuration from a top-level key matching its camelCase name. For example, `@stonyx/rest-server` reads from `config.restServer`.

Async modules ship with their own default config at `config/environment.ts` (or `.js`) inside the module package. Your project config is merged on top of these defaults — you only need to specify overrides.

## Logging Configuration

Any config key with a `logColor` property automatically creates a [Chronicle](logging.md) log type:

```js
export default {
  myService: {
    logColor: 'purple',      // Required — enables log creation
    logMethod: 'highlight',  // Optional — custom method name (defaults to key name)
    logTimestamp: true,       // Optional — include timestamps
  },
};
```

This works for both module configs and custom service configs. See [Logging](logging.md) for details.

## Test Environment Overrides

When `NODE_ENV=test`, Stonyx automatically looks for `test/config/environment.ts` (or `.js`) in your project root:

```ts
// test/config/environment.ts
export default {
  debug: false,
  restServer: { port: 0 },
};
```

These overrides are deep-merged into the main config using in-place mutation, so any existing references (like `stonyx/config` exports) stay valid.

## Accessing Config at Runtime

```js
import config from 'stonyx/config';

console.log(config.environment); // 'development', 'test', etc.
```

The `stonyx/config` export is a live reference to the Stonyx instance config. It will throw if accessed before Stonyx is initialized.
