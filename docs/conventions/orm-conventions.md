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

Access classes define which models they govern and implement an `access()` method. One access file per logical access boundary in `access/`.

**Structure:** `models` property → `access()` method

```js
export default class GlobalAccess {
  models = ['owner', 'animal', 'trait', 'category', 'phone-number'];

  access(request) {
    const { originalUrl: url } = request;

    // Return false to deny
    if (url.endsWith('/owners/angela')) return false;

    // Return a filter function for conditional access
    if (url.endsWith('/owners')) return record => record.id !== 'angela';
    if (url.endsWith('/animals')) return record => record.owner !== 'angela';

    // Return permission array for full access
    return ['read', 'create', 'update', 'delete'];
  }
}
```

The `models` property accepts an array of model names, or `'*'` to match all models.

`access()` return values:
- `false` — deny access
- `function` — filter function applied to response records
- `string[]` — allowed operations (e.g., `['read', 'create', 'update', 'delete']`)

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
