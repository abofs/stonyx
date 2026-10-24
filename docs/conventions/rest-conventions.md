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

// Stand-in for your own config or credential lookup.
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

Handler signature: `(request, state) => responseData`. `request` is the express request. The return value becomes the response:
- an object is sent as JSON
- `undefined` sends 200 with the body `OK`
- an integer is sent as that status code
- anything else (a string, for example) is a 500

### Middleware Chaining

Use `[middlewareFn, ..., handlerFn]` arrays to run middleware before a handler. Each middleware receives `(request, state)` and is awaited in order, so it may be `async`. It can:
- Mutate `state` to pass data to the next function
- Return `undefined` to continue
- Return anything else to stop the request. That value becomes the response, with the same rules as a handler's return: an integer is a status code, an object is sent as JSON (and the handler never runs)

### `auth` Hook

Runs before the middleware and handler of every route in the class, after route matching (so `request.params` is populated). Return an error status code to reject the request. If it returns `undefined`, the request proceeds.

`auth` is **synchronous**. Its return value is not awaited, so an `async auth` returns a Promise and every request fails with 500, whether the Promise would resolve to `undefined` or to a status. Put async checks in handler-array middleware (as `accounts.ts` does), or in middleware the class adds to `this.expressInstance` in its constructor (as `base/api-request.ts` does).

`auth` may be an arrow-function property (as the samples write it) or a method: it is called as `this.auth(...)`, so both see the instance.

### Route Parameters

Express-style route params (`:param`) are available via `request.params`.

### Binding

Middleware functions are called with `this` bound to the request class instance, so a method works as middleware. The **final** handler of a route is called **without** binding `this`: write it as an arrow function (as `public.ts` does). A class method used as the final handler sees `this === undefined` and the request fails with 500.
