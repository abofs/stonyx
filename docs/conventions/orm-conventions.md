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

**Reference to copy:** [`test/sample/access/`](https://github.com/abofs/stonyx-orm/tree/dev/test/sample/access) in abofs/stonyx-orm, together with the [REST Server Integration](https://github.com/abofs/stonyx-orm/blob/dev/README.md#rest-server-integration) section of its README. The README's access examples are extracted and run against a live server on every CI run (`test/integration/readme-access/`).

**Structure:** `models` property → `access()` method. Prefer one class per model when the rules are model-specific: `access()` receives only the request, and the request does not name the model.

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
export default class AnimalAccess {
  models = ['animal'];

  access(request) {
    if (!('recordId' in request)) return false;

    const { recordId } = request;

    // A belongsTo is the related Record, not its id: compare `.id`
    // (`?.` so an unowned animal cannot 500 the collection)
    if (recordId === undefined) return record => record.owner?.id !== 'angela';

    return ['read', 'create', 'update', 'delete'];
  }
}
```

**Authorize on `request.recordId`, never on the URL.** `request.url` is relative to the mount point (`/angela`, not `/owners/angela`), so a suffix match against it never fires. `request.originalUrl` and `request.baseUrl` are the raw text the client sent, so query strings, trailing slashes, casing and percent-encoding all change them while addressing the same record. `request.recordId` is computed by the same function the record lookup uses, so the two cannot disagree. It is `undefined` on collection routes. For a numeric-id model it is a number, so compare it against a number.

**Filter on a relationship's id.** Inside a filter function, a `belongsTo` property is the related Record, not its id. `record.owner !== 'angela'` compares a Record with a string, so it is always true and filters nothing. Use `record.owner?.id`.

The `models` property accepts an array of model names, or `'*'` to match all models. A class may list several models when they share one rule.

`access()` return values:
- `false` (or any falsy value): deny the request with 403
- `string[]`: the allowed operations (`'read'`, `'create'`, `'update'`, `'delete'`). A request whose operation is not listed gets 403
- `function`: **authorizes the whole request, writes included**. The operations list is not consulted, so returning a filter for a collection route also permits `POST` to it. The function is then applied as a filter to the response records. Return a function only where every method on that route may proceed

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

// Read — sync, from memory (requires memory: true on model, which is the default)
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
