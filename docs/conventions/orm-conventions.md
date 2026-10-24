# ORM Conventions

## Models

Models define the data structure with attributes and relationships. One model per file in `models/`.

**Property ordering:** `attr()` → `belongsTo()` / `hasMany()` → computed getters

```js
import { Model, attr, belongsTo, hasMany } from '@stonyx/orm';
import { ANIMALS } from '../constants.js';

export default class AnimalModel extends Model {
  type = attr('animal');
  age = attr('number');
  size = attr('string');

  owner = belongsTo('owner');
  traits = hasMany('trait');

  get tag() {
    const { owner, size } = this;

    if (!owner) {
      return `Unowned ${size} ${ANIMALS[this.type]}`;
    }

    return `${owner.id}'s ${size} ${ANIMALS[this.type]}`;
  }
}
```

### Property Flattening

Every property must resolve to a final data type — no passthrough objects. If an API returns a nested object, create a sub-model with `belongsTo` rather than storing the raw object.

### Nested Models

Use nested directories for `belongsTo` children:

```
models/
  character.js
  character/
    relationship.js
```

## Serializers

Serializers map raw external data to the model shape. One serializer per model in `serializers/`.

The serializer has a single `map` property. It is responsible for mapping only, not fetching.

```js
import { Serializer } from '@stonyx/orm';

const COLOR_TRAIT_MAP = {
  'black': 2,
  'white': 3,
}

export default class AnimalSerializer extends Serializer {
  map = {
    age: 'details.age',
    size: 'details.c',
    color: 'details.x',
    owner: 'details.location.owner',

    // Array value: [sourcePath, customHandler]
    traits: ['details', ({ x:color }) => {
      const traits = [{ id: 1, type: 'habitat', value: 'farm', category: 'physical' }];

      const id = COLOR_TRAIT_MAP[color];
      if (id) traits.push({ id, type: 'color', value: color, category: 'appearance' });

      return traits;
    }]
  }
}
```

### Clients vs Serializers

- **Clients** fetch, decrypt, and provide raw data from external sources
- **Serializers** map that raw data to the model shape

Clients handle I/O; serializers handle structure. Never mix the two.

## Access Control

Access classes define which models they govern and implement an `access()` method. They live in `access/`.

**Reference to copy:** the `OwnerAccess` example in the "REST Server Integration" section of the `@stonyx/orm` README; the README's `AnimalAccess` shows the same deny for a numeric id. The README ships in the package (`node_modules/@stonyx/orm/README.md`), and abofs/stonyx-orm's `pnpm test:readme` extracts both examples and runs them against a live server on every CI run (`test/integration/readme-access/`). Online: [REST Server Integration](https://github.com/abofs/stonyx-orm/blob/dev/README.md#rest-server-integration).

The repo's `test/sample/access/global-access.ts` is a test fixture that demonstrates a deny, a collection filter and the `owner?.id` filter together. Do not copy its shape: it derives the model from `request.baseUrl`, which the rules below advise against, and it has no `'recordId' in request` guard. Read its "Intentional Gap" note, which applies to the README examples as well (see [A deny is not a record boundary](#a-deny-is-not-a-record-boundary)).

**Structure:** `models` property → `access()` method. Prefer one class per model when the rules are model-specific: `access()` receives only the request, and the request does not name the model.

`OwnerAccess` below has the README's code; its comments are this doc's. `PrivateAnimalAccess` is not in the README and `test:readme` does not run it; it shows the record-route rule described in [A deny is not a record boundary](#a-deny-is-not-a-record-boundary).

```js
export default class OwnerAccess {
  models = ['owner'];

  access(request) {
    // Fail closed on a build that predates abofs/stonyx-orm#270, which never
    // attaches `recordId`. Without this guard the collection branch below
    // would fire on the record route and authorize it outright.
    if (!('recordId' in request)) return false;

    // The id the ORM resolves the record by, already normalised. Authorize
    // on it, never on a URL and never on raw `params.id`.
    const { recordId } = request;

    // Return false to deny
    if (recordId === 'angela') return false;

    // No `recordId` means the collection route. A returned function filters the
    // response records AND authorizes the whole request, POST /owners included.
    if (recordId === undefined) return record => record.id !== 'angela';

    // Return the allowed operations for everything else
    return ['read', 'create', 'update', 'delete'];
  }
}
```

```js
import { store } from '@stonyx/orm';

export default class PrivateAnimalAccess {
  models = ['animal'];

  access(request) {
    if (!('recordId' in request)) return false;

    const { recordId } = request;

    // Collection route: the filter removes angela's animals from the response.
    // A belongsTo is the related Record, not its id: compare `.id`
    // (`?.` so an unowned animal cannot 500 the collection)
    if (recordId === undefined) return record => record.owner?.id !== 'angela';

    // Record and relationship routes: a filter would authorize these outright,
    // so look the record up and deny. access() is synchronous: use store.get,
    // which reads only records held in memory (see below).
    if (store.get('animal', recordId)?.owner?.id === 'angela') return false;

    return ['read', 'create', 'update', 'delete'];
  }
}
```

**Authorize on `request.recordId`, never on the URL.** `request.url` is relative to the mount point (`/angela`, not `/owners/angela`), so a suffix match against it never fires. `request.originalUrl` is the raw text the client sent, so query strings, trailing slashes, casing and percent-encoding all change it while addressing the same record. `request.baseUrl` is the mount as the client spelled it. The rest server matches routes case-sensitively by default, so `/OwNeRs/angela` returns 404; with `restServer.caseSensitiveRoutes: false` it reaches the `owners` routes with `baseUrl` `/OwNeRs`. `request.recordId` is computed by the same function the record lookup uses, so the two cannot disagree. It is `undefined` on collection routes. For a numeric-id model it is a number, so compare it against a number.

**Filter on a relationship's id.** Inside a filter function, a `belongsTo` property is the related Record, not its id. `record.owner !== 'angela'` compares a Record with a string, so it is always true and filters nothing. Use `record.owner?.id`.

The `models` property accepts an array of model names, or `'*'` to match all models. A class may list several models when they share one rule.

`access()` return values:
- `false` (or any falsy value): deny the request with 403
- `string[]`: the allowed operations (`'read'`, `'create'`, `'update'`, `'delete'`). A request whose operation is not listed gets 403
- `function`: **authorizes the whole request, writes included**. The operations list is not consulted, so returning a filter for a collection route also permits `POST` to it. The function filters only the primary records of a `GET` collection response. On record routes, relationship routes and `included` it filters nothing, so there it grants access outright. Return a function only on the collection route, and only where every method on that route may proceed

### A deny is not a record boundary

**A deny protects a record only on its own model's routes.** Relationship routes (`/:id/<relationship>`, `/:id/relationships/<relationship>`) and `?include=` are authorized only by the access class of the route's *source* model; the related model's class is never consulted. With the README's `OwnerAccess` and `AnimalAccess`, `/owners/angela` is refused, but `GET /animals/1/owner`, `GET /animals/1/relationships/owner` and `GET /animals/1?include=owner` serve her owner record (200), because the README's `AnimalAccess` authorizes them. Her other animals are open as well: `GET /animals/1` returns 200, `PATCH /animals/1` returns 200 and the write lands, and `GET /animals` lists every one of hers except 7, the id the README denies.

The sample fixture carries the same warning: "Intentional Gap: this denies only /owners/angela and filters angela out of /owners. Her data is still served on related routes: her animals by id (/animals/1), her full owner record via an animal (/animals/1/owner), its linkage (/animals/1/relationships/owner), and her pets (/owners/angela/pets). A per-route deny is not a record boundary." (`/owners/angela/pets` is refused under `OwnerAccess`, because it denies every route whose `recordId` is `angela`.)

To keep a record private, every model that can reach it through a relationship needs its own rule, in its own access class. A filter is not that rule: it filters only the `GET` collection, and on every other route it authorizes the request. On record and relationship routes, look the record up and return `false`, as `PrivateAnimalAccess` does. With `OwnerAccess` and `PrivateAnimalAccess`, and both models held in memory (below), `GET /animals/1`, `GET /animals/1/owner`, `GET /animals/1/relationships/owner`, `GET /animals/1?include=owner`, `PATCH /animals/7` and `DELETE /animals/7` all return 403, and `GET /animals` omits her animals. `POST /animals` is still authorized, because the collection rule is a function. The ORM does not enforce a boundary across models for you, so verify each route of each model that can reach the record against a running server, on the storage backend you deploy.

**The lookup needs the records in memory.** `store.get` reads only the in-memory store, and `access()` cannot await `store.find`. In JSON file mode every record is in memory. With a MySQL or Postgres adapter, a model's records are in memory only if the model declares `static memory = true`; the default is `false`. Without it, `store.get` returns `undefined`, `record.owner` is `undefined` in the filter, and `PrivateAnimalAccess` allows every route on her animals, `PATCH` and `DELETE` included, and `GET /animals` lists them. Declare it on every model the rule reads, here `animal` and `owner`:

```js
import { Model, attr, belongsTo } from '@stonyx/orm';

export default class AnimalModel extends Model {
  static memory = true;

  size = attr('string');

  owner = belongsTo('owner');
}
```

## Transforms

Transforms are default-exported functions (not classes) that convert values. One transform per model in `transforms/`.

```js
import { ANIMALS } from '../constants.js';

const codeEnumMap = {}

for (let i = 0; i < ANIMALS.length; i++) codeEnumMap[ANIMALS[i]] = i;

export default function(value) {
  return codeEnumMap[value] || 0;
}
```

## Hooks

Use `beforeHook` / `afterHook` from `@stonyx/orm/hooks`. Place hook files in `hooks/`.

## DB Schema

The database schema extends `Model` and uses `hasMany` for each collection:

```js
import { Model, hasMany } from '@stonyx/orm';

export default class DBModel extends Model {
  owners = hasMany('owner');
  animals = hasMany('animal');
  traits = hasMany('trait');
  categories = hasMany('category');
  phoneNumbers = hasMany('phone-number');
}
```

Located at `config/db-schema.js`, referenced from `config/environment.js`.

## Store

The store is the in-memory data layer. Use it for internal app logic (not REST API consumers).

```js
import Orm, { store, createRecord, updateRecord } from '@stonyx/orm';

// Read — sync, from memory only. With a SQL adapter, requires static memory = true
// on the model (the default is false); in JSON file mode every record is in memory
const record = store.get('animal', 1);
const allAnimals = store.data.get('animals');

// Read — async, queries DB if memory: false
const record = await store.find('animal', 1);
const all = await store.findAll('animal');

// Create — adds to store and returns the record
const animal = createRecord('animal', { type: 'dog', age: 3, owner: 'angela' });

// Update — patches fields on an existing record
updateRecord(animal, { age: 4 });

// Delete
store.remove('animal', 1);

// Persist to disk — required when not using REST-triggered autosave
await Orm.db.save();
```

**When to use `Orm.db.save()`**: The `autosave: 'onUpdate'` config only triggers on REST POST/PATCH/DELETE. When modifying data directly via `createRecord` / `updateRecord` in app code (not through REST), call `Orm.db.save()` explicitly to persist.

**Store vs REST**: Use `store` for internal app logic (session tracking, state management). Use REST request handlers for external API consumers. Both operate on the same in-memory data.
