# Stonyx

**Stonyx** is a lightweight, modular framework for building modern Node.js applications. It provides a **plug-and-play architecture**, centralized color-coded logging, and seamless integration of asynchronous modules, making development faster, cleaner, and more maintainable.

### Highlights

* ✅ 100% JavaScript
* ✅ Drop-in file system for most modules
* ✅ Don’t even hit the ground — just fly
* ✅ High performance

Stonyx acts as a **base application host**, allowing you to add official modules (`@stonyx/*`) or your own custom modules without boilerplate initialization.

---

## Quick Start

The Stonyx CLI handles bootstrapping and module initialization automatically:

```bash
stonyx serve    # Bootstrap + run app.js (or --entry custom.js)
stonyx test     # Bootstrap + run test/**/*-test.js
```

No manual bootstrap files or `new Stonyx()` calls needed — the CLI reads `config/environment.js`, initializes all modules, and runs your application.

---

## Core Features

### 1. **Modular Architecture**

* Automatically detects modules in `devDependencies` prefixed with `@stonyx/`.
* Supports async initialization with `stonyx-async` modules.
* Safe module sequencing for submodule development with `waitForModule()`.

### 2. **Color-Coded Logging**

* Centralized logging via [Chronicle](https://github.com/abofs/chronicle).
* Module-specific logs configurable in `environment.js`:

```js
restServer: { logColor: 'yellow', logMethod: 'api', logTimestamp: true }
```

* Create custom logs for any class with minimal configuration.

### 3. **Singleton Design**

* Only one instance of Stonyx exists per project.
* Ensures consistent access to modules, logs, and configuration.

### 4. **Plug-and-Play Module Loading**

* Modules with `stonyx-module` keyword in `package.json` are auto-initialized.
* Modules with `stonyx-async` keyword are awaited automatically before usage.

---

## Official Modules

### **[@stonyx/cron](https://github.com/abofs/stonyx-cron)**

Lightweight asynchronous job scheduling utility.

```js
import Cron from '@stonyx/cron';

const cron = new Cron();
cron.register('exampleJob', async () => console.log('Job executed!'), 5, true);
```

* Efficient scheduling using a min-heap.
* Optional logging via `config.cron`.

---

### **[@stonyx/rest-server](https://github.com/abofs/stonyx-rest-server)**

Dynamic REST server module with auto-route registration.

```js
import Stonyx from 'stonyx';
import config from './config/environment.js';

new Stonyx(config);
```

* Zero configuration for routes: drop request classes into the `requests` directory.
* Automatic path generation, JSON parsing, and CORS handling.
* Supports per-route authentication hooks.

---

### **[@stonyx/orm](https://github.com/abofs/stonyx-orm)**

Lightweight ORM with model definitions, relationships, serializers, and optional REST integration.

```js
import Stonyx from 'stonyx';
import config from './config/environment.js';

new Stonyx(config);

// Define models
import { Model, attr, hasMany, belongsTo } from '@stonyx/orm';

class Owner extends Model {
  id = attr('string');
  pets = hasMany('animal');
}
```

* Auto-loads models, serializers, transforms, and access classes.
* Optional JSON file persistence with auto-save intervals.
* Integrates with `@stonyx/rest-server` for automatic route setup.

---

## Configuration

All modules are configurable via `config/environment.js`:

```js
export default {
  restServer: { logColor: 'yellow', port: 3000 },
  orm: { logColor: 'white', db: { file: './db.json', autosave: true } },
  cron: { log: true }
};
```

---

## Running the Application

```bash
stonyx serve          # Start the app (loads app.js by default)
stonyx serve --entry custom.js  # Start with a custom entry point
```

---

## Developing Submodules

For developers building new Stonyx modules, the CLI handles initialization. Use `waitForModule()` if your module depends on another async module:

```js
import { waitForModule } from 'stonyx';

// Wait for specific async module readiness
await waitForModule('restServer');
```

* Use `waitForModule()` **only for submodule development**, testing, or when you need to ensure a specific module is fully initialized before continuing.
* Official modules automatically initialize during normal application startup, so end-users do **not** need to call `waitForModule()`.

---

## License

Apache 2.0 — do what you want, just keep attribution.
