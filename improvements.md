# Stonyx — Improvement Opportunities

Code quality findings from a full project review. Organized by category.

---

## WET Code / Duplicate Patterns

### 1. Duplicate Bootstrap Pattern

**Files:** `src/cli/serve.js:19-23`, `src/cli.js:43-46`

Both locations repeat the same Stonyx bootstrap sequence:

```js
const { default: config } = await import(`${cwd}/config/environment.js`);
const { default: Stonyx } = await import('./main.js');
new Stonyx(config, cwd);
await Stonyx.ready;
```

**Suggestion:** Extract a shared `bootstrap(cwd)` utility that both serve and module commands can call. This would live in something like `src/cli/bootstrap.js`.

---

### 2. Duplicate Log Configuration Logic

**Files:** `src/modules.js:12-17` (`configureLog`), `src/main.js:73-86` (`configureUserLogs`)

Both do essentially the same thing — check for `logColor` in a config object and call `chronicle.defineType()`:

```js
// modules.js
function configureLog(chronicle, module, config) {
  const { logColor, logMethod, logTimestamp } = config;
  if (!logColor) return;
  chronicle.defineType(logMethod || module, logColor, { logTimestamp: !!logTimestamp });
}

// main.js
configureUserLogs() {
  for (const [className, config] of Object.entries(this.config)) {
    if (!config || typeof config !== 'object') continue;
    if (chronicle[className]) continue;
    const { logColor, logMethod, logTimestamp } = config;
    if (!logColor) continue;
    chronicle.defineType(logMethod || className, logColor, { logTimestamp: !!logTimestamp });
  }
}
```

**Suggestion:** Extract a single `configureLog(chronicle, name, config)` utility and use it in both places. The `configureUserLogs` method can iterate and call the shared function.

---

### 3. Inconsistent File Reading

**Files:** `src/modules.js:5` vs `src/cli/load-commands.js:1`

- `modules.js` uses `readFile` from `@stonyx/utils/file` (which handles JSON parsing via options)
- `load-commands.js` uses `readFile` from `fs/promises` and manually calls `JSON.parse`

**Suggestion:** Use `@stonyx/utils/file` consistently across the codebase. The utility already handles JSON parsing, error callbacks, and edge cases.

---

## Bugs

### 4. Typo in Error Message

**File:** `src/modules.js:109`

```js
if (!modulePromise) throw new Error(`Could wait for module: ${module}. Module was not registered in project dependencies`);
```

Should be `"Could not wait for module"`.

---

### 5. JSDoc Comment Typo

**File:** `src/main.js:72`

```js
 *   & }
```

Should be `* }` — the `&` is a typo for `*`.

---

## Dead / Unused Code

### 6. Unused Static Property

**File:** `src/main.js:24`

```js
static modulePromises = {};
```

This property is declared on the `Stonyx` class but never read or written to. The actual `modulePromises` object lives as a module-level variable in `src/modules.js:9`. This static property can be removed.

---

## Architecture / Refactoring

### 7. Module Loader Class Extraction

**File:** `src/modules.js:3` (existing TODO)

There's already a TODO comment: `Refactor into a ModuleLoader class`. The current module exports a default function with several helper functions. A class would:
- Encapsulate `modulePromises` as instance state instead of module-level state
- Make the module loader testable in isolation (no shared mutable state)
- Allow for potential future features like module hot-reloading

---

### 8. `environment copy.js` Naming Convention

**File:** `config/environment copy.js`

The postinstall template file has a space in its name. This is unconventional and could cause issues with some tooling.

**Suggestion:** Rename to `config/environment.template.js` or `config/environment.default.js`.

---

### 9. test-setup.js Uses CommonJS in an ESM Project

**File:** `src/cli/test-setup.js`

```js
import { createRequire } from 'module';
const require = createRequire(pathToFileURL(`${cwd}/package.json`));
const Stonyx = require('stonyx').default;
```

The entire project uses ES modules (`"type": "module"`), but `test-setup.js` creates a `require` function to load Stonyx. This is likely a workaround for QUnit's `--require` flag. Worth investigating if there's a cleaner ESM-compatible approach.

---

## Minor Improvements

### 10. Standalone Module Config Detection

**File:** `src/main.js:38`

```js
if (rootPath.includes('stonyx-')) {
```

This string check is fragile — any path containing `stonyx-` (e.g., `/home/user/my-stonyx-app/`) would trigger standalone mode. A more precise check would be to read the root `package.json` and check for the `stonyx-module` keyword, similar to what `modules.js:51` already does.

---

### 11. Missing Validation in waitForModule

**File:** `src/modules.js:105-112`

`waitForModule` prepends `@stonyx/` to the module name, but doesn't guard against being called before modules are set up. If called too early, `modulePromises[module]` would be `undefined` and the error message has the typo noted in item #4.

---

## Summary

| # | Type | Severity | File |
|---|------|----------|------|
| 1 | WET code | Medium | serve.js, cli.js |
| 2 | WET code | Medium | modules.js, main.js |
| 3 | Inconsistency | Low | modules.js, load-commands.js |
| 4 | Bug | Low | modules.js |
| 5 | Bug | Trivial | main.js |
| 6 | Dead code | Low | main.js |
| 7 | Architecture | Medium | modules.js |
| 8 | Convention | Low | config/ |
| 9 | Inconsistency | Low | test-setup.js |
| 10 | Fragile logic | Medium | main.js |
| 11 | Missing guard | Low | modules.js |
