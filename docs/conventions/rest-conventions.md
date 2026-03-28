# REST Conventions

## Request Classes

One request class per file in `requests/`. Each class extends `Request` from `@stonyx/rest-server`.

**Class ordering:** properties → `handlers` object → `auth()` hook → validation/middleware methods

### Public Request (no auth)

```js
import { Request } from '@stonyx/rest-server';

export default class PublicRequest extends Request {
  testProp = 'stonyx';

  handlers = {
    get: {
      '/': (_request, _state) => {
        return { data: 'foo' };
      },

      '/url-params/:x/:y/:z': ({ params }, _state) => {
        return params;
      },

      // Middleware chaining: [middlewareFn, handlerFn]
      '/foo': [this.validationSuccessSample, (_request, state) => {
        return { data: state };
      }],

      '/fail': [this.validationFailureSample, (_request, _state) => {
        return { unreachable: 'response' };
      }],
    }
  }

  validationSuccessSample(_request, state) {
    state.newProp = 'bar';
  }

  validationFailureSample() {
    return 504; // returning a status code rejects the request
  }
}
```

### Private Request (with auth)

```js
import { Request } from '@stonyx/rest-server';

export default class PrivateRequest extends Request {
  handlers = {
    get: {
      '/success': (_request, _state) => {
        return { data: 'foo' };
      },

      '/failure': (_request, _state) => {
        return { data: 'foo' };
      }
    }
  }

  auth(request, _state) {
    if (request.path === '/failure') return 505;
  }
}
```

## Key Patterns

### `handlers` Object

Keyed by HTTP method (`get`, `post`, `put`, `delete`), each containing route-to-handler mappings.

Handler signature: `(request, state) => responseData`

### Middleware Chaining

Use `[middlewareFn, handlerFn]` arrays to chain middleware before a handler. The middleware function receives `(request, state)` and can:
- Mutate `state` to pass data to the handler
- Return a status code number to reject the request early

### `auth()` Hook

Runs before all handlers in the class. Return an error status code to reject the request. If `auth()` returns nothing (undefined), the request proceeds.

### Route Parameters

Express-style route params (`:param`) are available via `request.params`.

### Binding

Handler functions defined as arrow functions or class methods have access to `this` (the request class instance).
