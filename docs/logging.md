# Logging

Stonyx provides centralized, color-coded logging via [Chronicle](https://github.com/abofs/chronicle).

## Overview

Every Stonyx instance creates a Chronicle logger with a default `title` log type (green). Modules and user services can register additional log types with custom colors.

## Module Logs

Modules that specify `logColor` in their configuration automatically get a Chronicle log type:

```js
// config/environment.js
export default {
  restServer: {
    logColor: 'yellow',
    logMethod: 'api',        // Optional — defaults to the config key name
    logTimestamp: true,       // Optional — adds timestamps to log output
  },
};
```

This creates a `chronicle.api()` method that outputs in yellow with timestamps.

## Custom Logs

You can define logs for any class or service in your project — not just Stonyx modules:

```js
export default {
  myWorker: {
    logColor: 'cyan',
    logMethod: 'worker',
    logTimestamp: true,
  },
};
```

Any top-level config key with a `logColor` property will have a log type created automatically.

## Accessing the Logger

```js
import log from 'stonyx/log';

log.title('Application started');
log.api('Request received');       // If restServer config defines logMethod: 'api'
log.worker('Processing job');      // If myWorker config defines logMethod: 'worker'
```

The `stonyx/log` export is the Chronicle instance, bound once at first import. It throws at import time if Stonyx is not yet initialized, so import it only from code that loads after bootstrap.
