# Cron Conventions

Scheduling conventions for `@stonyx/cron`. Covers the legacy interval API and the advanced scheduling system.

**Reference to copy:** [`test/sample/payload.ts`](https://github.com/abofs/stonyx-cron/blob/dev/test/sample/payload.ts) in abofs/stonyx-cron, which defines a job of every kind below (legacy intervals, `every`, `cron`, `at`, a `systemEvent` payload, the flat AI-style input and a disabled job). The module's tests load it, and the examples below use its values. It is not in the npm package.

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

## How do I…

Each answer names the definition in [`test/sample/payload.ts`](https://github.com/abofs/stonyx-cron/blob/dev/test/sample/payload.ts) (abofs/stonyx-cron) that shows it.

**Run a callback every N seconds?** `register(key, callback, intervalSeconds, runOnInit)` on the `Cron` singleton, as in [Legacy API](#legacy-api-simple-intervals). Sample: `legacyHealthCheck` and `legacyBackup`.

**Run a job at a time of day, in a time zone?** `CronService.add` with `schedule: { kind: 'cron', expr, tz }`. Sample: `dailyMorning`.

**Run a job once, at a given time?** `CronService.add` with `schedule: { kind: 'at', at }` and an ISO-8601 string. Sample: `oneShot`.

**Keep a job defined but stop it from running?** Add it with `enabled: false`; `list()` omits it unless you pass `{ includeDisabled: true }`. Sample: `disabled`.

**Accept a loosely shaped job from an AI tool call?** Pass it to `CronService.add` as is; it is normalized (see [AI Input Normalization](#ai-input-normalization)). Sample: `aiFlat`.

## Not a gap, by design

These are absent on purpose. Each has an intended pattern, so a report that one is missing is a usage question (see [Before you report a gap or bug](./index.md#before-you-report-a-gap-or-bug)).

- **No `crons/` directory.** The cron module discovers no files. A job exists once your code calls `register` or `CronService.add`, so put those calls in code that runs at startup. `stonyx test` does not import `app.js`, so a test that needs a job registers it itself.
- **The legacy `Cron` has no history, CRUD or cron expressions.** It runs callbacks on an interval. For anything more, use `CronService` from `@stonyx/cron/service` (see [When to Use Which](#when-to-use-which)).
