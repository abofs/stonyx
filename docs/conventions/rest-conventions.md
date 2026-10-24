# REST Conventions

**Reference to copy:** the request classes in `test/sample/requests/` of [abofs/stonyx-rest-server](https://github.com/abofs/stonyx-rest-server/tree/dev/test/sample/requests). The module's integration tests serve every one of them over HTTP (`test/integration/rest-server-test.ts` and `test/integration/sample-patterns-test.ts`), so they stay correct. They are TypeScript. To copy one as JavaScript, remove the type annotations and type imports and rename relative `.ts` imports to `.js`, as the blocks below do. The samples are not in the npm package.

- [`public.ts`](https://github.com/abofs/stonyx-rest-server/blob/dev/test/sample/requests/public.ts): a request with no `auth`, URL params, middleware chaining and `this` in handlers
- [`base/api-request.ts`](https://github.com/abofs/stonyx-rest-server/blob/dev/test/sample/requests/base/api-request.ts) and [`accounts.ts`](https://github.com/abofs/stonyx-rest-server/blob/dev/test/sample/requests/accounts.ts): an `auth` hook shared through a base class, and async handler-array middleware
- [`widgets.ts`](https://github.com/abofs/stonyx-rest-server/blob/dev/test/sample/requests/widgets.ts): response headers and a status other than 200
- [`private.ts`](https://github.com/abofs/stonyx-rest-server/blob/dev/test/sample/requests/private.ts) is a test fixture, not a sample to copy: its `auth` returns 505 for a fixed path so the suite can assert a rejection

## Request Classes

One request class per file in `requests/`. Each class extends `Request` from `@stonyx/rest-server`. The file name is the mount path (`requests/accounts.js` serves `/accounts`). Discovery reads `requests/` non-recursively, so a base class in a subdirectory such as `requests/base/` is never mounted as a route of its own.

**Class ordering:** constructor (if any) → properties → `handlers` object → `auth` hook → middleware methods. Class fields initialise in order, so a middleware written as an arrow-function **property** must be declared **before** `handlers`, which reads it. A middleware written as a class **method** can come after `handlers`.

### Public Request (no auth)

From `public.ts`:

```js
import { Request } from '@stonyx/rest-server';

export default class PublicRequest extends Request {
  testProp = 'stonyx';

  handlers = {
    get: {
      '/': () => {
        return { data: 'foo' };
      },

      '/url-params/:x/:y/:z': ({ params }) => {
        return params;
      },

      // Middleware chaining: [middlewareFn, handlerFn]
      '/foo': [this.validationSuccessSample, (_request, state) => {
        return { data: state };
      }],

      '/fail': [this.validationFailureSample, () => {
        return { unreachable: 'response' };
      }],

      // The final handler is called without binding `this`. Use an arrow
      // function to reach the class instance.
      '/bind': () => {
        return { data: this.testProp };
      },
    }
  };

  validationSuccessSample(_request, state) {
    state.newProp = 'bar';
  }

  validationFailureSample() {
    return 504; // returning a status code rejects the request
  }
}
```

### Authenticated Requests (shared `auth` in a base class)

From `base/api-request.ts`, without its version-gate constructor (see the sample for that). Authorize on a credential, compared in constant time. Never authorize on the URL text (`request.path`, `request.url`, `request.originalUrl`): the router and a string comparison can disagree about which URLs are the same route.

```js
// requests/base/api-request.js
import { timingSafeEqual } from 'node:crypto';
import { Request } from '@stonyx/rest-server';

// Stand-in. In an app, read the credential from config or the environment
// (never a literal in source), and refuse to start when it is empty.
const SAMPLE_TOKEN = Buffer.from('Bearer sample-token');

// timingSafeEqual throws on buffers of different lengths, hence the length check first.
function tokenMatches(header) {
  const given = Buffer.from(header ?? '');
  return given.length === SAMPLE_TOKEN.length && timingSafeEqual(given, SAMPLE_TOKEN);
}

export default class ApiRequest extends Request {
  // Inherited by every subclass. Synchronous: return a status code to reject,
  // or undefined to allow.
  auth = request => {
    if (!tokenMatches(request.get('authorization'))) return 401;
    return undefined;
  };
}
```

From `accounts.ts`, which inherits that `auth`:

```js
// requests/accounts.js
import ApiRequest from './base/api-request.js';

// Stand-in for a database or remote lookup.
// A Map, not an object literal: `ACCOUNTS['constructor']` on a plain object
// finds Object.prototype and would pass the not-found check.
const ACCOUNTS = new Map([
  ['1', { id: '1', name: 'Ada' }]
]);

async function findAccount(id) {
  await new Promise(resolve => setTimeout(resolve, 1));
  return ACCOUNTS.get(id);
}

export default class AccountsRequest extends ApiRequest {
  // Declared before `handlers`, which reads it.
  loadAccount = async (request, state) => {
    const { id } = request.params;
    const account = typeof id === 'string' ? await findAccount(id) : undefined;
    if (!account) return 404;

    state.account = account;
    return undefined;
  };

  handlers = {
    get: {
      '/:id': [this.loadAccount, (_request, state) => {
        const { account } = state;
        return { data: { type: 'accounts', id: account.id, attributes: { name: account.name } } };
      }]
    }
  };
}
```

## Key Patterns

### `handlers` Object

Keyed by HTTP method (`get`, `post`, `put`, `patch`, `delete`), each containing route-to-handler mappings. Any other key is skipped with a warning.

Handler signature: `(request, state) => responseData`. `request` is the express request. The return value becomes the response, checked in this order:
1. an integer is sent as that status code
2. if `state.redirect` is set (by the handler or any middleware), the response is a 302 to it, whatever the handler returned (an object, `undefined` or a string)
3. if `state.pipe` is set (`{ source, headers }`), `source` is piped as the body, whatever the handler returned
4. `undefined` sends 200 with the body `OK`
5. an object is sent as JSON; `null` counts as an object and sends 200 with an empty body
6. anything else (a string, `true`) is a 500

### Middleware Chaining

Use `[middlewareFn, ..., handlerFn]` arrays to run middleware before a handler. Each middleware receives `(request, state)` and is awaited in order, so it may be `async`. It can:
- Mutate `state` to pass data to the next function
- Return `undefined` to continue
- Return anything else to stop the request. The handler never runs, and that value becomes the response under the same rules as a handler's return: an integer is a status code, an object is sent as JSON, `null` is 200 with an empty body, a string is a 500

### `auth` Hook

Runs before the middleware and handler of every route in the class, after route matching (so `request.params` is populated). Return a non-zero integer status code (401, 403) to reject the request with that status. Return `undefined` to let it proceed.

**Never return a boolean.** The check is `if (status)`, so **any** falsy return lets the request through: `undefined`, `false`, `null`, `0` and `''` all reach the handler. `true` is not a status code and gives a 500. An `auth` written as `request => tokenMatches(request)` therefore fails open: every bad token gets in, and every good one gets a 500. Write `if (!tokenMatches(...)) return 401;` as the example above does.

`auth` is **synchronous**. Its return value is not awaited, so an `async auth` returns a Promise and every request fails with 500, whether the Promise would resolve to `undefined` or to a status. Put async checks in handler-array middleware (as `accounts.ts` does), or in middleware the class adds to `this.expressInstance` in its constructor (as `base/api-request.ts` does).

`auth` may be an arrow-function property (as the samples write it) or a method: it is called as `this.auth(...)`, so both see the instance.

### Route Parameters

Express-style route params (`:param`) are available via `request.params`.

### Binding

Middleware functions are called with `this` bound to the request class instance, so a method works as middleware. The **final** handler of a route is called **without** binding `this`: write it as an arrow function (as `public.ts` does). A class method used as the final handler sees `this === undefined`: `this.x` throws and the request fails with 500, and `this?.x` silently yields `undefined`. A method that never reads `this` works, but write final handlers as arrow functions anyway.

## How do I…

Each answer names the sample that shows it. The integration tests in abofs/stonyx-rest-server serve every sample below over HTTP and assert the behaviour described: `test/integration/sample-patterns-test.ts` for `base/api-request.ts`, `accounts.ts` and `widgets.ts`, and `test/integration/rest-server-test.ts` for `public.ts`.

**Run the same check (a version gate, say) in front of every route of many request classes?** Put it in a base class that extends `Request`. Middleware added to `this.expressInstance` in its constructor runs before every route of every subclass, and before `auth`. It may be async, and it owns the response, so it can send any status and body. Sample: [`base/api-request.ts`](https://github.com/abofs/stonyx-rest-server/blob/dev/test/sample/requests/base/api-request.ts).

**Share one `auth` across request classes?** Define `auth` on the base class: every subclass inherits it. Keep the base class in a subdirectory such as `requests/base/`, which route discovery does not read, so it is never a route of its own. Sample: [`base/api-request.ts`](https://github.com/abofs/stonyx-rest-server/blob/dev/test/sample/requests/base/api-request.ts), extended by [`accounts.ts`](https://github.com/abofs/stonyx-rest-server/blob/dev/test/sample/requests/accounts.ts).

**Authorize a request?** Compare a credential (a header, a token) in `auth`, in constant time, and return a status such as 401 when it fails. Never authorize on the URL text. Sample: `tokenMatches` and `auth` in [`base/api-request.ts`](https://github.com/abofs/stonyx-rest-server/blob/dev/test/sample/requests/base/api-request.ts).

**Do async work (a database lookup, a remote check) before a handler?** Not in `auth`, which is synchronous. Put it in handler-array middleware, which is awaited: set `state` and return `undefined` to continue, or return a status to stop. Sample: `loadAccount` in [`accounts.ts`](https://github.com/abofs/stonyx-rest-server/blob/dev/test/sample/requests/accounts.ts).

**Set response headers, or a status other than 200 with a JSON body?** For one route, call `request.res.status(201).set(...)` in the handler and return the object. For every route of a class, add `this.expressInstance.use((request, response, next) => { response.set(...); next(); })` in the constructor. Sample: [`widgets.ts`](https://github.com/abofs/stonyx-rest-server/blob/dev/test/sample/requests/widgets.ts).

**Reach the class instance (`this`) in a handler, or reject from middleware?** Write the final handler as an arrow function; a middleware method is bound for you. Return a status code from middleware to reject. Sample: the `/bind` and `/fail` routes in [`public.ts`](https://github.com/abofs/stonyx-rest-server/blob/dev/test/sample/requests/public.ts).

## Not a gap, by design

These are absent on purpose. Each has an intended pattern, so a report that one is missing is a usage question (see [Before you report a gap or bug](./index.md#before-you-report-a-gap-or-bug)).

- **No global request hook.** Each file in `requests/` is its own express sub-app, and nothing registers middleware for all of them. Extend a base `Request` and add the middleware in its constructor (see the first How-do-I above). The sample's header comment says the same.
- **No async `auth`.** `auth`'s return value is not awaited. A Promise-returning `auth` fails every request with 500, whatever the Promise resolves to (pinned by "auth is synchronous" in `sample-patterns-test.ts`). Do async work in handler-array middleware.
- **A falsy `auth` return lets the request through.** `undefined`, `false`, `null`, `0` and `''` all reach the handler, and `true` gives a 500. There is no boolean contract: write `if (!ok) return 401;` (see [`auth` Hook](#auth-hook)).
- **No response argument and no header API on handlers.** Handlers receive `(request, state)`. Use `request.res`, or `this.expressInstance` middleware (see [`widgets.ts`](https://github.com/abofs/stonyx-rest-server/blob/dev/test/sample/requests/widgets.ts)).
- **The final handler is not bound to `this`.** Only middleware is bound. A method reference as the final handler fails with 500 (pinned by "the final handler is not bound" in `sample-patterns-test.ts`). Use an arrow function.
- **Route discovery does not recurse.** A class in a subdirectory of `requests/` is not mounted. That is what lets a base class live in `requests/base/`.
