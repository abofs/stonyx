# Testing

Stonyx includes built-in test infrastructure using [QUnit](https://qunitjs.com/).

## Running Tests

```bash
stonyx test                     # Runs test/**/*-test.{js,ts} by default
stonyx test "test/unit/**/*.js" # Custom glob pattern
```

The default glob matches both `.js` and `.ts` test files, so TypeScript test suites run without any CLI argument.

The test command:
1. Sets `NODE_ENV=test`
2. Bootstraps Stonyx via a `--require` setup file
3. Applies [test config overrides](configuration.md#test-environment-overrides)
4. Runs QUnit with the specified glob

## Test Config Overrides

Create `test/config/environment.js` to override configuration during tests:

```js
export default {
  debug: false,
  restServer: { port: 0 },
};
```

These are deep-merged into the main config. See [Configuration](configuration.md#test-environment-overrides).

## Integration Test Helper

For tests that need Stonyx fully initialized (e.g., testing modules with database connections):

```js
import { setupIntegrationTests } from 'stonyx/test-helpers';

const { module, test } = QUnit;

module('My Integration Test', function(hooks) {
  setupIntegrationTests(hooks);

  test('can access modules', function(assert) {
    // Stonyx is fully initialized here
    assert.ok(true);
  });
});
```

`setupIntegrationTests` adds a `before` hook that waits for `Stonyx.ready` to resolve.

## Test File Convention

Place tests under `test/` with the `-test.js` suffix:

```
test/
  unit/
    my-feature-test.js
    cli/
      serve-test.js
  integration/
    api-test.js
  acceptance/
    fresh-clone-scaffold-test.ts
```

## Fresh-Clone Scaffold Acceptance Harness

> ### This suite is RED ON PURPOSE. Do not "fix" a failing assertion in it.
>
> `test/acceptance/fresh-clone-scaffold-test.ts` is the measuring instrument for
> the [#88](https://github.com/abofs/stonyx/issues/88) epic. It was written
> **first, against unfixed `dev`**, so that its red output is the deliverable —
> a harness written after the fixes cannot be shown to have been capable of
> failing. Six of its thirteen assertions fail today. Each one names the issue
> that owns it:
>
> | assertion | owned by |
> |---|---|
> | the test-config override is tracked by git | [#90](https://github.com/abofs/stonyx/issues/90) |
> | the test-config override is not gitignored | [#90](https://github.com/abofs/stonyx/issues/90) |
> | a sentinel present only in the test override wins after a real boot | [#90](https://github.com/abofs/stonyx/issues/90) |
> | the clone builds (`pnpm build` exits 0) | [#91](https://github.com/abofs/stonyx/issues/91) |
> | the clone serves (`stonyx serve` exits 0 on SIGTERM) | [#91](https://github.com/abofs/stonyx/issues/91) |
> | the scaffold pins an exact `stonyx` version, not a dist-tag | [#92](https://github.com/abofs/stonyx/issues/92) |
>
> **Fix the defect in the story that owns it — never the assertion here.** The
> remaining assertions are preconditions plus one class-level clone-parity
> guard; the guard passes today and is kept because it catches the next
> instance of the swallow, not because it is currently failing.
>
> [#93](https://github.com/abofs/stonyx/issues/93) has **no assertion here** and
> cannot get one: it is a machine-derived completeness guard over the
> test-config surface, and nothing in a fresh-clone lifecycle observes it. #93
> must be verified by its own tests.
>
> **When #90-#92 are all closed and every assertion is green, delete this
> notice** along with `test/acceptance/expected-failures.json`.

`test/acceptance/fresh-clone-scaffold-test.ts` runs the whole `stonyx new`
lifecycle end to end: `rm -rf dist && pnpm build && npm pack`, generate a
project, commit it, `git clone` it to a **second** directory, then install the
packed tarball, build, serve and boot — asserting the generated project's
behaviour only in the clone.

```bash
pnpm test:acceptance          # raw TAP; red today, by design
pnpm test:acceptance:ratchet  # the same run, diffed against the baseline (what CI runs)
```

> **This command is not read-only.** It **deletes and rebuilds your working
> tree's `dist/`** (and does not restore it if the rebuild fails — run
> `pnpm build`), performs a real **network** `pnpm install` of a generated
> project, and **binds a TCP port**. It takes minutes.

It is **not excluded from `pnpm test`** — the default glob `test/**/*-test.ts`
matches it. It self-skips via the `STONYX_ACCEPTANCE=1` gate and registers a
single skipped assertion. That environment variable is the only thing between
`pnpm test` and the side effects above, so do not export it in a shell or CI
environment. `pnpm test:acceptance` sets it for you.

### The expected-failures ratchet

An always-red check is the worst kind: nobody re-examines it, and it cannot
signal a *new* failure because it is already failing. So CI does not run the
harness bare. `scripts/acceptance-ratchet.js` runs it and diffs the observed red
set against `test/acceptance/expected-failures.json` **in both directions**:

| observed | baseline | result |
|---|---|---|
| fails | listed | expected — job stays green |
| fails | not listed | **red** — a regression, or an assertion with no owning issue |
| passes | listed | **red** — shrink the baseline in the PR that fixed it |
| absent | listed | **red** — a baselined assertion was renamed or removed |

The third row is the point: **each of #90-#92 must delete its own entries from
the baseline in its own PR.** That converts "verify against the harness before
completion" from a note on an issue into an enforced gate rather than a line on
an issue that nobody re-reads.

A dedicated CI job (`.github/workflows/scaffold-acceptance.yml`) runs the
ratchet on every PR touching `src/**`, `scripts/**`, `package.json`, the
`config/environment copy.*` templates or the harness itself, and on pushes to
`dev`. Stonyx repos carry no branch protection, so it blocks nothing — it is a
signal, not a gate.

### Why the second directory

Several defects tracked on [#88](https://github.com/abofs/stonyx/issues/88)
are **invisible from the directory where the scaffold ran**. The generated
project's `.gitignore` carries `*.js` and `*.d.ts` to keep in-place `tsc`
output untracked, and that rule also swallows hand-authored source files the
project mandates elsewhere. Those files exist locally and are merely untracked,
so lint, typecheck and the suite are all green on the author's machine and
absent in CI. Only a clone shows it.

### Three vacuity traps it is built around

Each was verified by execution, not by reasoning. Anything asserting on this
lifecycle has to handle all three or it can report green while the defect is
fully live.

| trap | why the obvious check is vacuous | what the harness does |
|---|---|---|
| `git check-ignore` is index-aware | it reports "not ignored" for any tracked path, so it goes green with `*.js` fully live — and in a fresh clone of a fixed repo the file is always tracked, so it cannot fail there at all | `--no-index`, paired with `git ls-files`; each catches a different regression |
| a stale `dist/` | a `dist/util/import-config.js` predating `4c80c87` still resolves `.ts` configs, producing a green run of the central assertion from a build artifact | `rm -rf dist && pnpm build && npm pack` in the same run, installing that tarball and never a workspace link |
| tsx rewrites `.js` to a `.ts` sibling | importer-dependent: from a `.ts` importer, `import(pathToFileURL('…/cfg.js'))` yields `cfg.ts`; from a `.js` importer inside `node_modules` it does not | asserts no `.ts`/`.js` sibling pair exists at the override base path |

### Mutation proof

`STONYX_ACCEPTANCE_CONTROL` hand-patches the throwaway generated project so
each assertion can be observed going green. It is evidence, not a fix — it
touches nothing in this repo and no normal run applies it. (The ratchet refuses
to run with it set, because a controlled run says nothing about the baseline.)

```bash
STONYX_ACCEPTANCE_CONTROL=fixed   pnpm test:acceptance   # expect all green
STONYX_ACCEPTANCE_CONTROL=swallow pnpm test:acceptance   # expect clone parity to fail
```

> **The `fixed` control is NOT the target design for #90.** To go green it
> renames `test/config/environment.ts` to `.js` and adds a
> `!test/config/environment.js` negation to the generated `.gitignore` — which
> is **the route #90 explicitly rejected**, named there as the most fragile
> alternative and as the "two mandatory artifacts, one ignore rule, opposite
> requirements" trap recorded on #88. Under the accepted ownership split the
> override **stays `.ts`** and needs no negation at all. The control takes the
> crude route *because* it is throwaway evidence. An implementer of #90-#92 who
> reaches for this flag has misread their acceptance criteria.

### Environment and isolation

Child processes get an **allowlisted** environment (`PATH`, `HOME`, `TMPDIR`,
proxy and CA settings, and the harness's own variables) rather than
`{ ...process.env }`. The serve smoke boots a real `@stonyx/orm` application,
and `@stonyx/orm` builds live PostgreSQL / MySQL / Timescale connection blocks
from ambient `*_HOST` / `*_PASSWORD`. A harness whose premise is that it models
a clean consumer environment must not hand children the developer's.

The generated project's dependencies other than `stonyx` itself resolve at the
`latest` dist-tag with no lockfile — that is deliberate, because it is what the
scaffold emits and what #92 exists to change. It also means a newly published
`@stonyx/orm` alpha can move an outcome with no change to this repo. The
ratchet is what surfaces that: an unexpected flip in either direction fails the
job rather than passing quietly.
