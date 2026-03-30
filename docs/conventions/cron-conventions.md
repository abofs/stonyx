# Cron Conventions

Scheduling conventions for `@stonyx/cron`. Covers the legacy interval API and the advanced scheduling system.

## Legacy API (Simple Intervals)

For basic recurring callbacks, use the `Cron` class directly:

```js
import Cron from '@stonyx/cron';

const cron = new Cron();

// register(key, callback, intervalSeconds, runOnInit?)
cron.register('health-check', async () => {
  await checkHealth();
}, 300, true);

// Unregister when done
cron.unregister('health-check');
```

`Cron` is a singleton — only one instance per process.

## Advanced Scheduling (CronService)

For jobs with cron expressions, one-shot scheduling, AI input normalization, and run history:

```js
import CronService from '@stonyx/cron/service';

const service = new CronService();

service.onJobDue = async (job) => {
  // Execute the job's work
  return { status: 'ok', summary: 'completed' };
};

await service.start();
```

### Schedule Kinds

Three schedule types, specified in `schedule.kind`:

| Kind | Purpose | Required fields |
|------|---------|----------------|
| `every` | Recurring interval | `everyMs` (milliseconds) |
| `cron` | Cron expression | `expr` (5-field), optional `tz` |
| `at` | One-shot | `at` (ISO-8601 string) |

```js
// Recurring every 60 seconds
await service.add({
  name: 'Diagnostics',
  schedule: { kind: 'every', everyMs: 60_000 },
  payload: { kind: 'agentTurn', message: 'run diagnostics' },
});

// Daily at 9am Eastern
await service.add({
  name: 'Morning Report',
  schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'America/New_York' },
  payload: { kind: 'agentTurn', message: 'generate morning report' },
});

// One-shot reminder (auto-deletes after run)
await service.add({
  name: 'Reminder',
  schedule: { kind: 'at', at: '2026-07-01T12:00:00Z' },
  payload: { kind: 'agentTurn', message: 'follow up on PR' },
});
```

### Payload Kinds

| Kind | Target | Key field |
|------|--------|-----------|
| `agentTurn` | Isolated agent session | `message` |
| `systemEvent` | Main session | `text` |

`sessionTarget` is inferred automatically: `agentTurn` → `isolated`, `systemEvent` → `main`.

### CRUD

```js
const job = await service.add({ ... });    // Create
const found = service.get(job.id);         // Read
const updated = await service.update(job.id, { name: 'Renamed' }); // Update
await service.remove(job.id);              // Delete

// List (excludes disabled by default)
const jobs = service.list();
const all = service.list({ includeDisabled: true });
```

### Manual Execution

```js
// Force-run regardless of schedule
await service.run(job.id, 'force');

// Only run if due
await service.run(job.id, 'due');
```

### Run History

```js
const history = service.runs(job.id);
// [{ status, error?, summary?, runAtMs, durationMs, nextRunAtMs, ts }]
```

### AI Input Normalization

CronService accepts loose input from AI tool calls and normalizes it:

- Missing `schedule.kind` is inferred from fields (`everyMs` → `every`, `expr` → `cron`, `at` → `at`)
- Bare `message` or `text` at the top level is wrapped into a `payload`
- `deleteAfterRun` is auto-set for one-shot (`at`) jobs
- `delivery: { mode: 'announce' }` is auto-set for isolated `agentTurn` jobs

```js
// AI might send this flat structure
await service.add({
  name: 'Weather Check',
  schedule: { everyMs: 120000 },
  message: 'check the weather',
});

// Normalized to:
// {
//   schedule: { kind: 'every', everyMs: 120000 },
//   payload: { kind: 'agentTurn', message: 'check the weather' },
//   sessionTarget: 'isolated',
//   delivery: { mode: 'announce' },
// }
```

## ORM Data Model

When persisting cron data with `@stonyx/orm`, use the following model structure.

### Models

```
models/
  cron-job.js
  cron-job/
    schedule.js
    payload.js
    state.js
    delivery.js
  cron-run.js
```

**`cron-job.js`** — parent model with `belongsTo` for schedule, payload, state, and delivery sub-models (property flattening rule — no passthrough objects):

```js
import { Model, attr, belongsTo } from '@stonyx/orm';

export default class CronJobModel extends Model {
  name = attr('string');
  description = attr('string');
  enabled = attr('boolean');
  deleteAfterRun = attr('boolean');
  sessionTarget = attr('string');
  wakeMode = attr('string');
  createdAtMs = attr('number');
  updatedAtMs = attr('number');

  schedule = belongsTo('cron-job/schedule');
  payload = belongsTo('cron-job/payload');
  state = belongsTo('cron-job/state');
  delivery = belongsTo('cron-job/delivery');
}
```

**`cron-job/schedule.js`**

```js
import { Model, attr } from '@stonyx/orm';

export default class CronJobScheduleModel extends Model {
  kind = attr('string');
  at = attr('string');
  everyMs = attr('number');
  anchorMs = attr('number');
  expr = attr('string');
  tz = attr('string');
}
```

**`cron-job/payload.js`**

```js
import { Model, attr } from '@stonyx/orm';

export default class CronJobPayloadModel extends Model {
  kind = attr('string');
  message = attr('string');
  text = attr('string');
}
```

**`cron-job/state.js`**

```js
import { Model, attr } from '@stonyx/orm';

export default class CronJobStateModel extends Model {
  nextRunAtMs = attr('number');
  runningAtMs = attr('number');
  lastRunAtMs = attr('number');
  lastStatus = attr('string');
  lastError = attr('string');
  lastDurationMs = attr('number');
  consecutiveErrors = attr('number');
  scheduleErrorCount = attr('number');
}
```

**`cron-job/delivery.js`**

```js
import { Model, attr } from '@stonyx/orm';

export default class CronJobDeliveryModel extends Model {
  mode = attr('string');
}
```

**`cron-run.js`**

```js
import { Model, attr } from '@stonyx/orm';

export default class CronRunModel extends Model {
  jobId = attr('string');
  status = attr('string');
  error = attr('string');
  summary = attr('string');
  runAtMs = attr('number');
  durationMs = attr('number');
  nextRunAtMs = attr('number');
  ts = attr('number');
}
```

**Property ordering:** `attr()` → `belongsTo()` (on parent model).

### DB Schema

```js
import { Model, hasMany } from '@stonyx/orm';

export default class DBModel extends Model {
  cronJobs = hasMany('cron-job');
  cronJobSchedules = hasMany('cron-job/schedule');
  cronJobPayloads = hasMany('cron-job/payload');
  cronJobStates = hasMany('cron-job/state');
  cronJobDeliveries = hasMany('cron-job/delivery');
  cronRuns = hasMany('cron-run');
}
```

## Configuration

```js
// config/environment.js
export default {
  cron: {
    log: true,       // enable cron logging (uses stonyx/log)
  },
}
```

## When to Use Which

- **Simple recurring callback** → `Cron.register(key, callback, interval)`
- **Scheduled jobs with history, CRUD, AI input** → `CronService`
- **Never use raw `setInterval` or `setTimeout`** for recurring work
