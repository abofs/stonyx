/**
 * Coverage for `src/modules.ts` — module auto-discovery (`loadModules`) and
 * `waitForModule`. See abofs/stonyx#109.
 *
 * Every test below is a GUARD: it pins behaviour that is correct (or, for T13,
 * knowingly hazardous) as of today, and each names the mutation it dies under.
 * #109 changes no production behaviour.
 *
 * Isolation constraint: `modulePromises` (modules.ts:19) is module-level state
 * with no reset and is not exported. Every test MUST use a module name unique
 * to that test, or a later test resolves an earlier test's deferred promise
 * and the suite becomes order-dependent.
 */
import QUnit from 'qunit';
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import loadModules, { waitForModule } from '../../src/modules.js';
import { assertDistIsFresh } from '../helpers/dist-freshness.js';
import type { StoynxConfig } from '../../src/modules.js';
import {
  captureConsole,
  createRoot,
  environmentSource,
  installModule,
  moduleSource,
  removeRoot,
  stubChronicle,
  timeout,
  writeRootFile,
} from '../helpers/module-fixture.js';

const { module, test } = QUnit;

const execFileAsync = promisify(execFile);
const plainNodeModulesScript = resolve(
  dirname(fileURLToPath(import.meta.url)), '../helpers/load-modules-plain-node.mjs'
);

/**
 * Same hard bound as `import-config-test.ts` and `standalone-transform-test.ts`:
 * `execFile` has no default timeout and this repo sets no
 * `QUnit.config.testTimeout`, so an unbounded child hangs the run with no TAP.
 */
const SUBPROCESS_TIMEOUT_MS = 20_000;

interface PlainNodeLoadResult {
  thrown: { message: string; hasCause: boolean; causeMessage: string | null } | null;
  stderr: string[];
}

/** Drives `dist/modules.js` under plain node — no tsx. */
async function loadModulesInPlainNode(rootPath: string): Promise<PlainNodeLoadResult> {
  assertDistIsFresh('loadModulesInPlainNode');

  const { stdout, stderr } = await execFileAsync(
    'node',
    [ plainNodeModulesScript, rootPath ],
    { timeout: SUBPROCESS_TIMEOUT_MS, killSignal: 'SIGKILL' }
  );

  const marker = stdout.split('__LOAD_MODULES__')[1];
  if (!marker) throw new Error(`plain-node run produced no result. stdout: ${stdout}\nstderr: ${stderr}`);

  return JSON.parse(marker) as PlainNodeLoadResult;
}

/**
 * A root with one installed async module named `@stonyx/<slug>-mod`, plus
 * whatever config files the caller asks for. Deliberately writes raw files
 * rather than reusing `installAsyncModule`, because the point is to control
 * the config file's EXTENSION.
 */
function createPlainNodeRoot(slug: string, files: Record<string, string>): string {
  const name = `@stonyx/${slug}-mod`;
  const rootPath = root({ name: `${slug}-app`, devDependencies: { [name]: '1.0.0' }});

  installModule(rootPath, name, { main: 'main.js', keywords: [ 'stonyx-module', 'stonyx-async' ]}, {
    'main.js': moduleSource('PlainNodeMod'),
    ...files,
  });

  // `installModule` refuses traversal but not nesting; config/ needs creating
  // only when the caller asked for no files under it.
  mkdirSync(join(rootPath, 'node_modules', name, 'config'), { recursive: true });
  if (Object.keys(files).length === 0) writeFileSync(join(rootPath, 'node_modules', name, 'config', '.keep'), '');

  return rootPath;
}


const roots: string[] = [];

function root(pkg: Record<string, unknown>): string {
  const dir = createRoot(pkg);
  roots.push(dir);
  return dir;
}

/** An installed async stonyx module: discovered, configured and instantiated. */
function installAsyncModule(
  rootPath: string,
  name: string,
  className: string,
  defaults: Record<string, unknown> = {}
): void {
  installModule(rootPath, name, { keywords: [ 'stonyx-module', 'stonyx-async' ], main: 'main.js' }, {
    'main.js': moduleSource(className),
    'config/environment.js': environmentSource(defaults),
  });
}

/**
 * Races `waitForModule` against a fixed window. Used instead of a bare `await`
 * so that a mutation which leaves a promise unresolved fails the test rather
 * than hanging the run. Returns `'resolved'` or `'TIMEOUT'`; a rejection
 * propagates.
 */
function raceModule(name: string): Promise<string> {
  return Promise.race([ waitForModule(name).then(() => 'resolved'), timeout(250) ]);
}

/**
 * As `raceModule`, but reports a rejection as a value instead of propagating it.
 *
 * The distinction T23/T13 need is three-way — `'resolved'`, `'TIMEOUT'` (the
 * hang) and a NAMED rejection (fail-fast) — and `assert.rejects` cannot make
 * it: against an unresolved deferred promise it never settles, and this suite
 * sets no `QUnit.config.testTimeout`, so the run would produce no TAP at all
 * rather than a red test. The race window is what converts the hang into an
 * observable value.
 */
function raceModuleOutcome(name: string): Promise<string> {
  return Promise.race([
    waitForModule(name).then(() => 'resolved', (error: unknown) => `rejected: ${(error as Error).message}`),
    timeout(250),
  ]);
}

module('[Unit] loadModules', function(hooks) {
  hooks.afterEach(function() {
    while (roots.length) removeRoot(roots.pop()!);
  });

  // T1 — GUARD. Dies under M1 (`rootPackage.devDependencies` -> `rootPackage.dependencies`).
  test('discovers async modules declared in devDependencies and instantiates them', async function(assert) {
    const rootPath = root({ name: 't1-app', devDependencies: { '@stonyx/t1-alpha': '1.0.0' }});
    installAsyncModule(rootPath, '@stonyx/t1-alpha', 'T1Alpha', { port: 1 });

    const config: StoynxConfig = {};
    const modules = await loadModules(config, rootPath, stubChronicle().asChronicle());

    assert.strictEqual(modules.length, 1, 'one module instantiated');
    assert.strictEqual(modules[0]!.constructor.name, 'T1Alpha', 'the module class was instantiated');
    assert.true((modules[0] as { initialized?: boolean }).initialized, 'init() ran before loadModules resolved');
    assert.strictEqual((config.t1Alpha as Record<string, unknown>).port, 1, 'module defaults merged into config');
  });

  // T2 — GUARD, FLIPPED by abofs/stonyx#106 rule 3. This is the inversion that
  // issue's AC1 requires to appear inside #106's own diff.
  //
  // What it pinned before: `loadModules` read `devDependencies` only — the
  // `declaredDependencies` initializer, named rather than numbered because a
  // line number drifts and an identifier does not — so a real, installed
  // stonyx module declared in `dependencies` was invisible to discovery. That
  // was the contract, and it was not a desirable one: the published fleet pins
  // the core through `dependencies`, so the loader could not see its own
  // siblings.
  //
  // What it pins now: discovery scans the de-duplicated union of `dependencies`
  // and `devDependencies`, so the SAME fixture that used to yield nothing now
  // yields exactly one configured, instantiated module. The assertions below
  // are the inversion of the previous four on an unchanged fixture — the test
  // was not deleted, skipped, or weakened to `assert.ok(true)`.
  //
  // Dies under M1 reverted (`∪` -> `devDependencies` only): `modules` goes back
  // to empty and `config` back to `[ 'rootPath' ]`. It does NOT die under the
  // concat-shaped union (T22 owns that) nor under the `?.`-desync shortcut
  // (T21's invariant line owns that) — this test's fixture is declared in
  // exactly one map and is async, so it cannot see either hazard.
  test('discovers modules declared only in dependencies (abofs/stonyx#106 rule 3)', async function(assert) {
    const rootPath = root({ name: 't2-app', dependencies: { '@stonyx/t2-beta': '1.0.0' }});
    installAsyncModule(rootPath, '@stonyx/t2-beta', 'T2Beta', { port: 2 });

    const config: StoynxConfig = {};
    const modules = await loadModules(config, rootPath, stubChronicle().asChronicle());

    assert.strictEqual(modules.length, 1, 'a dependencies-only stonyx module is discovered');
    assert.strictEqual(modules[0]!.constructor.name, 'T2Beta', 'the module class was instantiated');
    assert.deepEqual(Object.keys(config), [ 'rootPath', 't2Beta' ], 'the module config block was added');
    assert.strictEqual((config.t2Beta as Record<string, unknown>).port, 2, 'module defaults merged into config');
  });

  // T3 — GUARD, on the exact line abofs/stonyx#106 rewrites (modules.ts:61-63).
  // Dies under M2 (`startsWith('@stonyx/')` -> `'@zzzzzz/'`), the NARROWING
  // direction, and under both WIDENING mutants, which an earlier version of
  // this test could not see. Both figures below are measured against this file
  // as it stood at 01d13ff, where the suite was 97 tests:
  //     `startsWith('@stonyx/')` -> `startsWith('@')`   measured 97/0 SURVIVED
  //     drop the prefix filter entirely                 measured 97/0 SURVIVED
  // An earlier revision of this note recorded the second as "96/1 SURVIVED",
  // which is self-contradictory and wrong -- no test failed. Re-measured at
  // this head (99 tests), both mutants read 98/1 with this test the sole
  // failure.
  //
  // Both were invisible because every negative fixture was UNSCOPED (`lodash`,
  // `my-stonyx-thing`), so nothing in the suite distinguished "only @stonyx/"
  // from "only scoped". `@types/node` is the scoped non-stonyx fixture that
  // does; it is in this repo's own devDependencies, so it is exactly what a
  // real consumer manifest looks like. It is load-bearing for the
  // `startsWith('@')` widening SPECIFICALLY: delete that one fixture line and
  // that mutant goes back to 99/0 SURVIVED, while drop-the-filter stays killed
  // at 98/1 -- an unfiltered list also stats `lodash` and `my-stonyx-thing`,
  // which the warnings assertion below already sees. Both are needed.
  //
  // The widening direction CANNOT be asserted through `waitForModule`, and this
  // is the trap: `waitForModule` unconditionally prepends `@stonyx/`
  // (modules.ts:129), so a registration under the bare key `lodash` or
  // `@types/node` is invisible to it, and `waitForModule('@types/node')` would
  // reject identically whether or not the widening happened. Asserting it that
  // way would be vacuous. The real observable is the loader warning: only the
  // FILTERED list is stat-ed (modules.ts:81-85), so a widened filter makes
  // `loadModules` stat and warn on every non-stonyx dependency in the manifest.
  test('registers only @stonyx/ scoped dependencies, not every scoped dependency', async function(assert) {
    const rootPath = root({
      name: 't3-app',
      devDependencies: {
        '@stonyx/t3-alpha': '1.0.0',
        '@types/node': '1.0.0',
        'lodash': '1.0.0',
        'my-stonyx-thing': '1.0.0',
      },
    });
    // Only the @stonyx/ entry is installed. The other three are declared and
    // absent, so anything that reaches the load loop announces itself.
    installAsyncModule(rootPath, '@stonyx/t3-alpha', 'T3Alpha');

    const capture = captureConsole();

    try {
      await loadModules({}, rootPath, stubChronicle().asChronicle());
    } finally {
      capture.restore();
    }

    assert.strictEqual(await raceModule('t3-alpha'), 'resolved', 'the @stonyx/ scoped dependency resolves');

    assert.deepEqual(
      capture.warnings,
      [],
      'nothing outside @stonyx/ was stat-ed: @types/node (scoped, non-stonyx) is filtered out, as are lodash and my-stonyx-thing (unscoped)'
    );

    for (const unregistered of [ 'lodash', 'my-stonyx-thing' ]) {
      await assert.rejects(
        waitForModule(unregistered),
        new Error(`Could wait for module: @stonyx/${unregistered}. Module was not registered in project dependencies`),
        `${unregistered} was not registered`
      );
    }
  });

  // T4 — GUARD, and pins F2 (the warning does not name the module) verbatim.
  // Dies under M4 (module `stonyx-module` gate -> `if (false)`).
  test('skips an installed module without the stonyx-module keyword and warns', async function(assert) {
    const rootPath = root({ name: 't4-app', devDependencies: { '@stonyx/t4-nokey': '1.0.0' }});
    installModule(rootPath, '@stonyx/t4-nokey', { keywords: [ 'something-else' ], main: 'main.js' }, {
      'main.js': moduleSource('T4Nokey'),
    });

    const capture = captureConsole();
    let modules;

    try {
      modules = await loadModules({}, rootPath, stubChronicle().asChronicle());
    } finally {
      capture.restore();
    }

    assert.deepEqual(modules, [], 'module was not loaded');
    assert.deepEqual(
      capture.warnings,
      [ 'Warning: Stonyx modules must contain the "stonyx-module" keyword. Module was not loaded' ],
      'warns exactly once, and the message does not name the module (F2, pinned as-is)'
    );
  });

  // T5 — GUARD. A sync `stonyx-module` is discovered but never instantiated.
  // Dies under M5 (`!keywords.includes('stonyx-async')` -> `if (false)`).
  test('resolves but never instantiates a stonyx-module without stonyx-async', async function(assert) {
    const rootPath = root({ name: 't5-app', devDependencies: { '@stonyx/t5-sync': '1.0.0' }});
    installModule(rootPath, '@stonyx/t5-sync', { keywords: [ 'stonyx-module' ], main: 'main.js' }, {
      'main.js': moduleSource('T5Sync'),
      'config/environment.js': environmentSource({ port: 5 }),
    });

    const config: StoynxConfig = {};
    const modules = await loadModules(config, rootPath, stubChronicle().asChronicle());

    assert.deepEqual(modules, [], 'sync module is never instantiated');
    assert.deepEqual(Object.keys(config), [ 'rootPath' ], 'sync module contributes no config block');

    assert.strictEqual(await raceModule('t5-sync'), 'resolved', 'its promise is resolved anyway');
  });

  // T6 — GUARD. Dies under M6 (missingFileCallback fabricates a package instead of warning + returning '').
  test('warns and continues when a declared module is not installed', async function(assert) {
    const rootPath = root({ name: 't6-app', devDependencies: { '@stonyx/t6-absent': '1.0.0' }});

    const capture = captureConsole();
    let modules;

    try {
      modules = await loadModules({}, rootPath, stubChronicle().asChronicle());
    } finally {
      capture.restore();
    }

    assert.deepEqual(modules, [], 'nothing loaded');
    assert.deepEqual(
      capture.warnings,
      [ 'Warning: Could not locate stonyx module: "@stonyx/t6-absent". Module was not loaded' ],
      'names the missing module'
    );
  });

  // T7 — GUARD. The missing-file callback fires on ENOENT only; a malformed
  // package.json is a hard reject. Dies under: make the call site swallow every
  // error through the same fallback.
  test('rejects on a malformed module package.json without invoking the missing-file callback', async function(assert) {
    const rootPath = root({ name: 't7-app', devDependencies: { '@stonyx/t7-broken': '1.0.0' }});
    installModule(rootPath, '@stonyx/t7-broken', '{ not json');

    const capture = captureConsole();
    let error: unknown;

    try {
      await loadModules({}, rootPath, stubChronicle().asChronicle());
    } catch (err) {
      error = err;
    } finally {
      capture.restore();
    }

    assert.true(error instanceof SyntaxError, `rejects with a SyntaxError, got: ${String(error)}`);
    assert.deepEqual(capture.warnings, [], 'the missing-file callback did not fire');
  });

  // T8 — GUARD. Dies under M8 (`typeof rootPackage.main === 'string' ? ... : ''` -> `'main.js'`).
  // `main.js` exists on disk, so the only thing keeping this red is the empty entry point.
  test('rejects when a standalone root declares no main field', async function(assert) {
    const rootPath = root({ name: 'stonyx-t8-alpha', keywords: [ 'stonyx-module' ]});
    writeRootFile(rootPath, 'main.js', moduleSource('T8Alpha'));

    let error: NodeJS.ErrnoException | undefined;

    try {
      await loadModules({}, rootPath, stubChronicle().asChronicle());
    } catch (err) {
      error = err as NodeJS.ErrnoException;
    }

    assert.strictEqual(error?.code, 'ERR_MODULE_NOT_FOUND', `rejects with ERR_MODULE_NOT_FOUND, got: ${String(error)}`);
  });

  // T9 — FLIPPED BY abofs/stonyx#108. It previously PINNED F4: the thrown
  // message blamed a missing config/environment.js even though that file was
  // present, and the real error survived only as an unlinked `console.error`.
  // Both halves are now inverted — the throw names the step that actually
  // failed and carries the original as `cause`, and nothing is written to
  // stderr behind the caller's back.
  // Dies under: reverting modules.ts's split try/catch to the single relabel.
  test('names the real load failure and attaches it as `cause`, without a side-channel log', async function(assert) {
    const rootPath = root({ name: 't9-app', devDependencies: { '@stonyx/t9-nomain': '1.0.0' }});
    installModule(rootPath, '@stonyx/t9-nomain', { keywords: [ 'stonyx-module', 'stonyx-async' ]}, {
      'config/environment.js': environmentSource({ port: 9 }),
    });

    const capture = captureConsole();
    let error: unknown;

    try {
      await loadModules({}, rootPath, stubChronicle().asChronicle());
    } catch (err) {
      error = err;
    } finally {
      capture.restore();
    }

    const thrown = error as Error | undefined;

    assert.ok(
      thrown?.message.startsWith('Stonyx module "@stonyx/t9-nomain" failed while importing its entry point'),
      `the thrown message names the step that failed, got: ${thrown?.message}`
    );
    assert.notOk(
      thrown?.message.includes('must have a config/environment.js file'),
      'and no longer blames a config file that is present and correct'
    );
    assert.strictEqual(
      (thrown?.cause as NodeJS.ErrnoException | undefined)?.code,
      'ERR_MODULE_NOT_FOUND',
      'the original error is reachable through `cause`, not only on stderr'
    );
    assert.strictEqual(capture.errors.length, 0, 'and nothing was written to stderr behind the caller');
  });

  // T10 — GUARD, and pins F3: the standalone path passes the raw kebab-case
  // package name to configureLog (the module path passes camelCase).
  // Dies under M3 (root `stonyx-module` gate -> `if (false)`).
  test('loads the root package itself when it carries the stonyx-module keyword', async function(assert) {
    const rootPath = root({ name: 'stonyx-t10-alpha', keywords: [ 'stonyx-module' ], main: 'main.js' });
    writeRootFile(rootPath, 'main.js', moduleSource('T10Alpha'));

    const chronicle = stubChronicle();
    const modules = await loadModules({ logColor: 'red' }, rootPath, chronicle.asChronicle());

    assert.strictEqual(modules.length, 1, 'the root was loaded as a standalone module');
    assert.strictEqual(modules[0]!.constructor.name, 'T10Alpha', 'the root module class was instantiated');
    assert.true((modules[0] as { initialized?: boolean }).initialized, 'init() ran');
    assert.deepEqual(
      chronicle.defineTypeCalls,
      [ [ 'stonyx-t10-alpha', 'red', { logTimestamp: false } ] ],
      'configureLog receives the raw package name on the standalone path (F3, pinned as-is)'
    );
  });

  // T11 — GUARD. The pre-registration loop and the load loop must consume the
  // same list. Dies under M7 (`moduleDependencies.slice(1)` in the registration
  // loop at modules.ts:66). This is the regression #106 rule 3 can introduce by
  // widening the filter at :61 without widening registration at :66.
  test('pre-registers every filtered dependency, not a subset', async function(assert) {
    const rootPath = root({
      name: 't11-app',
      devDependencies: {
        '@stonyx/t11-a-async': '1.0.0',
        '@stonyx/t11-b-sync': '1.0.0',
        '@stonyx/t11-c-sync': '1.0.0',
      },
    });
    installAsyncModule(rootPath, '@stonyx/t11-a-async', 'T11AAsync');

    for (const name of [ 't11-b-sync', 't11-c-sync' ]) {
      installModule(rootPath, `@stonyx/${name}`, { keywords: [ 'stonyx-module' ], main: 'main.js' }, {
        'main.js': moduleSource('T11Sync'),
      });
    }

    let loadError: unknown;

    try {
      await loadModules({}, rootPath, stubChronicle().asChronicle());
    } catch (err) {
      loadError = err;
    }

    assert.strictEqual(loadError, undefined, `loadModules resolved without a TypeError, got: ${String(loadError)}`);

    for (const name of [ 't11-a-async', 't11-b-sync', 't11-c-sync' ]) {
      assert.strictEqual(await raceModule(name), 'resolved', `${name} was registered and resolved`);
    }
  });

  // T21 — FORWARD GUARD for abofs/stonyx#106 rule 3. Green today and green
  // under a CORRECT rule 3; red only under the desync #106 is most likely to
  // produce. T11 does NOT cover this, contrary to #106 amendment 2.
  //
  // The hazard: rule 3 widens the load list at modules.ts:61 while the
  // registration loop at :66 still derives from `devDependencies`. That desync
  // is BLOCK-SCOPED, not positional. T11's guard is positional
  // (`moduleDependencies.slice(1)`) and every one of T11's fixtures lives in
  // `devDependencies`, so the desync leaves T11 green and reads 96/1 —
  // byte-identical to a correct implementation. It is invisible to the suite.
  //
  // This fixture is the discriminator. A SYNC module (`stonyx-module`, no
  // `stonyx-async`) declared ONLY in `dependencies` takes the `:96` branch and
  // calls `modulePromises[moduleName].resolve()` at `:97` on a name the
  // registration loop never registered:
  //     TypeError: Cannot read properties of undefined (reading 'resolve')
  //
  // It must be SYNC. An async fixture cannot reach `:97` — it is instantiated
  // through `initializeModule`, which resolves through the optional chain at
  // modules.ts:43 (`modulePromises[moduleName]?.resolve()`) and swallows the
  // same desync silently. That is also why T2's async fixture cannot catch it.
  //
  // Today `@stonyx/t21-sync` is in `dependencies`, so discovery never sees it
  // and `loadModules` trivially resolves. The assertion is deliberately
  // narrow — "does not throw" — because the pass condition must survive rule 3
  // changing what gets loaded. #106 must keep this test green.
  //
  // #106 MUST ALSO ADD to this test, inside #106's own diff, at the same time
  // it flips T2:
  //     assert.strictEqual(await raceModule('t21-sync'), 'resolved', …);
  // "Does not throw" is the SYMPTOM. "Every discovered module is
  // pre-registered" is the INVARIANT, and one character separates them.
  // Measured at this head, simulating a completed #106 by inverting T2's
  // assertions exactly as T2's note prescribes:
  //     T2 inverted + correct rule 3                     99/0
  //     T2 inverted + desync + `?.` at modules.ts:97     99/0  — IDENTICAL
  // The second of those ships a rule 3 where every `dependencies`-declared
  // module loads and `waitForModule` on it throws "was not registered"
  // forever, with the suite fully green. The line above splits them: still
  // 99/0 under a correct rule 3, but 98/1 with this test the SOLE failure
  // under the desync, rejecting by name from `waitForModule` (today that is
  // its declared-but-not-loaded branch, since `t21-sync` IS declared; the
  // wording is quoted nowhere here because it drifts and the branch does not).
  //
  // And if this test reds at `:97` inside #106, adding `?.` there is NOT the
  // fix. `modules.ts:43` already carries that exact optional chain three lines
  // from `initializeModule`, so it is the first thing to hand — and it only
  // converts a loud TypeError into a promise that is registered nowhere and
  // resolves never. The fix is to make the registration loop at `:66` consume
  // the same list as `:61`.
  //
  // Rule 3 has now landed, so the invariant line below is live. It is the
  // ONLY change #106 makes to this test.
  test('does not throw for a sync stonyx-module declared only in dependencies (forward guard for #106)', async function(assert) {
    const rootPath = root({ name: 't21-app', dependencies: { '@stonyx/t21-sync': '1.0.0' }});
    installModule(rootPath, '@stonyx/t21-sync', { keywords: [ 'stonyx-module' ], main: 'main.js' }, {
      'main.js': moduleSource('T21Sync'),
    });

    let loadError: unknown;

    try {
      await loadModules({}, rootPath, stubChronicle().asChronicle());
    } catch (err) {
      loadError = err;
    }

    assert.strictEqual(
      loadError,
      undefined,
      `loadModules resolved without a TypeError at modules.ts:97, got: ${String(loadError)}`
    );

    // abofs/stonyx#106 AC2 — the INVARIANT, not the symptom. "Does not throw"
    // survives the `?.`-at-the-sync-resolve shortcut; "every discovered module
    // is pre-registered" does not. Under that shortcut this rejects from
    // `waitForModule` naming `@stonyx/t21-sync` while the aggregate count is
    // otherwise identical.
    assert.strictEqual(
      await raceModule('t21-sync'),
      'resolved',
      'every discovered module is pre-registered, so waitForModule resolves'
    );
  });

  // T22 — FORWARD GUARD for abofs/stonyx#106 rule 3. Green today, green under a
  // CORRECT rule 3, red under the concat-shaped one.
  //
  // The hazard: rule 3 written at modules.ts:61 as
  //     [ ...Object.keys(dependencies), ...Object.keys(devDependencies) ].filter(…)
  // is a plausible, correct-LOOKING shape, and against every other fixture in
  // this suite it is indistinguishable from the correct union. Measured at this
  // head, with this test deleted: concat 97/1 and spread-union 97/1, T2 the sole
  // failure in both. With this test present: concat 97/2, spread-union 98/1.
  //
  // A module declared in BOTH maps appears twice in a concatenated list, so it
  // is instantiated twice and its `init()` runs twice. Measured out of suite on
  // a dual-declared root, `modules.length` / `initCount`:
  //     head (no rule 3)      1 / 1
  //     spread union          1 / 1
  //     concat                2 / 2
  // Every other fixture here is declared in exactly one map, so `:61`/`:66`
  // cannot see the duplicate without this one.
  //
  // The discriminator has to count INSTANCES. `modulePromises` is keyed by
  // module name (modules.ts:19), so a duplicate load just resolves the same
  // deferred promise twice — `waitForModule`/`raceModule` read 'resolved' either
  // way. `modules.length` and the class-level `initCount` from `moduleSource`
  // are the two observables that differ.
  test('loads a module declared in both dependencies and devDependencies exactly once', async function(assert) {
    const rootPath = root({
      name: 't22-app',
      dependencies: { '@stonyx/t22-dual': '1.0.0' },
      devDependencies: { '@stonyx/t22-dual': '1.0.0' },
    });
    installAsyncModule(rootPath, '@stonyx/t22-dual', 'T22Dual', { port: 22 });

    const config: StoynxConfig = {};
    const modules = await loadModules(config, rootPath, stubChronicle().asChronicle());

    assert.strictEqual(modules.length, 1, 'the dual-declared module was instantiated once, not once per map');
    assert.strictEqual(modules[0]!.constructor.name, 'T22Dual', 'and the instance is the module class');
    assert.strictEqual(
      (modules[0]!.constructor as unknown as { initCount: number }).initCount,
      1,
      'init() ran exactly once'
    );
  });

  // T12 — GUARD. Dies under: swap the `mergeObject(moduleConfig, userConfig)`
  // argument order at modules.ts:107.
  test('merges module defaults under user config: user wins, defaults fill, extras survive', async function(assert) {
    const rootPath = root({ name: 't12-app', devDependencies: { '@stonyx/t12-gamma': '1.0.0' }});
    installAsyncModule(rootPath, '@stonyx/t12-gamma', 'T12Gamma', { port: 1, logColor: 'cyan' });

    const config: StoynxConfig = { t12Gamma: { port: 9999, extra: true }};
    await loadModules(config, rootPath, stubChronicle().asChronicle());

    assert.deepEqual(config.t12Gamma, { port: 9999, logColor: 'cyan', extra: true }, 'user config takes precedence');
  });

  // T13 — WAS a hazard guard pinning F1; FLIPPED by PR #120 fix round 1.
  //
  // It used to pin the fact that the two `continue` paths in `loadModules`
  // leave `modulePromises[name]` permanently unresolved, so `waitForModule`
  // hangs forever with only a stderr warning. Its own note said the guard
  // existed "so a fix is a deliberate, visible change rather than a silent
  // one". This is that deliberate, visible change, and the flip is the record
  // of it.
  //
  // Scoping pre-registration to the DISCOVERED set (modules.ts) removes the
  // hang on both halves of the input domain, and they are not the same kind of
  // change:
  //   - `dependencies`-declared names — the hang was INTRODUCED by #106 rule 3
  //     (at base such a name was never registered, so `waitForModule` threw in
  //     milliseconds). T23 covers that half.
  //   - `devDependencies`-declared names — this fixture. The hang is
  //     INHERITED; it behaved identically at base `5693744`. Going from
  //     "hangs forever" to "throws, named, immediately" is a behaviour change
  //     this PR makes beyond the defect it introduced, and it is deliberate:
  //     a caller awaiting a module the loader refused to load has no correct
  //     outcome, and the named throw is the diagnosable one.
  //
  // The EXPECTED MESSAGE is the declared-but-not-loaded branch of
  // `waitForModule`, not the inherited one. `t13-nokey` is in this fixture's
  // `devDependencies`, so the inherited sentence — "Module was not registered
  // in project dependencies" — would be false about this very fixture. Round 1
  // pinned that false sentence here verbatim; this is the correction, and it is
  // why the assertion is on the exact text rather than on a substring.
  //
  // Dies under: restoring pre-registration over the full `moduleDependencies`
  // list (reads `TIMEOUT`), resolving the promise before the `continue` (reads
  // `resolved` — the silently-wrong shape, see T23), or collapsing
  // `waitForModule` back to one sentence (reads the inherited message).
  test('a keyword-rejected module is not registered, so waitForModule fails fast instead of hanging', async function(assert) {
    const rootPath = root({
      name: 't13-app',
      devDependencies: { '@stonyx/t13-alpha': '1.0.0', '@stonyx/t13-nokey': '1.0.0' },
    });
    installAsyncModule(rootPath, '@stonyx/t13-alpha', 'T13Alpha');
    installModule(rootPath, '@stonyx/t13-nokey', { keywords: [ 'something-else' ], main: 'main.js' }, {
      'main.js': moduleSource('T13Nokey'),
    });

    const capture = captureConsole();

    try {
      await loadModules({}, rootPath, stubChronicle().asChronicle());
    } finally {
      capture.restore();
    }

    // Premise first: a module that DOES resolve must win the same race window,
    // otherwise a timeout below would only prove the harness is broken.
    assert.strictEqual(
      await raceModule('t13-alpha'),
      'resolved',
      'premise: a loaded module resolves well inside the race window'
    );

    // And premise second: the `continue` this test is ABOUT was actually taken.
    // Without this the expected rejection is also the default state of a name
    // the loader never saw, so deleting `@stonyx/t13-nokey` from the fixture's
    // `devDependencies` — leaving the package on disk — left this test green.
    // Measured before this assertion existed. The warning is the loader's own
    // record of reaching the keyword branch, and this test already captured it
    // and threw it away.
    assert.deepEqual(
      capture.warnings,
      [ 'Warning: Stonyx modules must contain the "stonyx-module" keyword. Module was not loaded' ],
      'premise: discovery really did reach the missing-keyword continue for this fixture'
    );

    assert.strictEqual(
      await raceModuleOutcome('t13-nokey'),
      'rejected: Could wait for module: @stonyx/t13-nokey. It IS declared in this project\'s ' +
      'dependencies or devDependencies, but the loader did not load it: either it is not ' +
      'installed under node_modules, or its package.json does not carry the "stonyx-module" ' +
      'keyword. loadModules warned which one at load time.',
      'the keyword-rejected module is not registered at all, so waitForModule throws — and names the ' +
      'real cause, because the name IS in the manifest'
    );
  });

  // T23 — REGRESSION GUARD for the boot hang INTRODUCED by #106 rule 3
  // (PR #120, fix round 1). Red at `a57045e`, green after the fix.
  //
  // Rule 3 widened the discovery source, and the pre-registration loop
  // consumed the widened list directly — so every `@stonyx/*` name in
  // `dependencies` got a deferred promise, including names discovery then
  // `continue`s past without ever resolving. There are THREE resolve sites in
  // `src/modules.ts` — the no-`init()` early return, the `init()` wrapper, and
  // the sync-module `continue` in the load loop — and none of them is reachable
  // from a DISCOVERY `continue`. (This sentence said "exactly two" in the
  // commit that added the third.)
  //
  // Reproduced end to end before the fix, driving the real `loadModules`
  // against a root with `@stonyx/orm` in `dependencies` but absent from
  // `node_modules` (stale CI cache / partial restore) plus an installed module
  // whose `init()` awaits it:
  //     base 5693744  THREW "Could wait for module: @stonyx/orm. Module was
  //                   not registered in project dependencies" in 3 ms
  //     head a57045e  one console.warn, then loadModules NEVER SETTLED
  // A hang at boot is strictly worse than the throw it replaced: no exit code,
  // no crash reason, so a supervisor sees a container that never becomes
  // ready rather than one that failed.
  //
  // Both discovery `continue` paths are covered, because they are separate
  // sites: the missing-manifest path and the missing-keyword path. The second
  // is not hypothetical — `@stonyx/logs` ships WITHOUT the `stonyx-module`
  // keyword and is a natural `dependencies` entry for any app that constructs
  // a Chronicle directly.
  //
  // The assertion is on the NAMED rejection, not merely on "not TIMEOUT".
  // Resolving the promise in each `continue` branch also removes the hang and
  // would satisfy a weaker assertion — while making `waitForModule` report
  // success for a module that was never loaded. That is worse than the hang
  // and silent, so this test must be able to tell the two remedies apart.
  test('a dependencies-declared name that fails discovery is never registered (regression: #120 boot hang)', async function(assert) {
    const rootPath = root({
      name: 't23-app',
      dependencies: {
        '@stonyx/t23-absent': '1.0.0',
        '@stonyx/t23-nokey': '1.0.0',
        '@stonyx/t23-real': '1.0.0',
      },
    });

    // `@stonyx/t23-absent` is deliberately NOT installed.
    installAsyncModule(rootPath, '@stonyx/t23-real', 'T23Real');
    installModule(rootPath, '@stonyx/t23-nokey', { keywords: [ 'log', 'logging' ], main: 'main.js' }, {
      'main.js': moduleSource('T23Nokey'),
    });

    const capture = captureConsole();

    try {
      await loadModules({}, rootPath, stubChronicle().asChronicle());
    } finally {
      capture.restore();
    }

    // Premise first: rule 3 still holds. A real module declared in
    // `dependencies` is discovered, registered and resolved — the fix narrows
    // registration, it does not narrow discovery back to `devDependencies`.
    assert.strictEqual(
      await raceModule('t23-real'),
      'resolved',
      'premise: a dependencies-declared module is still discovered and still resolves'
    );

    // And that BOTH `continue`s were actually taken. The expected rejections
    // below are also the default state of a name the loader never saw, so
    // deleting either name from the fixture's `dependencies` — leaving the
    // package on disk — left this test green. Measured before this assertion
    // existed. These two warnings are the loader's own record of reaching each
    // branch, in discovery order, and this test already captured them.
    assert.deepEqual(
      capture.warnings,
      [
        'Warning: Could not locate stonyx module: "@stonyx/t23-absent". Module was not loaded',
        'Warning: Stonyx modules must contain the "stonyx-module" keyword. Module was not loaded',
      ],
      'premise: discovery reached the missing-manifest continue and then the missing-keyword one'
    );

    assert.strictEqual(
      await raceModuleOutcome('t23-absent'),
      'rejected: Could wait for module: @stonyx/t23-absent. It IS declared in this project\'s ' +
      'dependencies or devDependencies, but the loader did not load it: either it is not ' +
      'installed under node_modules, or its package.json does not carry the "stonyx-module" ' +
      'keyword. loadModules warned which one at load time.',
      'the missing-manifest continue path leaves no dangling promise, and the throw does not deny the ' +
      'declaration it can see'
    );
    assert.strictEqual(
      await raceModuleOutcome('t23-nokey'),
      'rejected: Could wait for module: @stonyx/t23-nokey. It IS declared in this project\'s ' +
      'dependencies or devDependencies, but the loader did not load it: either it is not ' +
      'installed under node_modules, or its package.json does not carry the "stonyx-module" ' +
      'keyword. loadModules warned which one at load time.',
      'nor does the missing-keyword continue path, and it too reports declared-but-not-loaded'
    );
  });

  // T24 — REGRESSION GUARD for the third leak named alongside the two above:
  // `initializeModule` returns early for a module class with no `init()`, so
  // the resolve one line below it never runs and the promise dangles.
  //
  // Scoping pre-registration to `discovered` does NOT close this one — such a
  // module IS discovered — and the gap was measured, not assumed: with the
  // registration fix applied and this arm unfixed, the same driver still read
  // "loadModules never settled". The module is loaded, instantiated and has
  // nothing to initialise, so resolving is the truthful report. This is the
  // one place resolving on behalf of a module is honest, and it is exactly
  // the opposite of resolving on a `continue` path (see T23).
  //
  // Dies under: dropping the resolve from the no-`init()` early return.
  test('a discovered async module whose class has no init() resolves rather than dangling', async function(assert) {
    const rootPath = root({ name: 't24-app', dependencies: { '@stonyx/t24-noinit': '1.0.0' }});
    installModule(rootPath, '@stonyx/t24-noinit', { keywords: [ 'stonyx-module', 'stonyx-async' ], main: 'main.js' }, {
      'main.js': 'export default class T24NoInit {}\n',
      'config/environment.js': environmentSource({}),
    });

    const modules = await loadModules({}, rootPath, stubChronicle().asChronicle());

    assert.strictEqual(modules.length, 1, 'premise: the module really was discovered and instantiated');
    assert.strictEqual(modules[0]!.constructor.name, 'T24NoInit', 'and it is the module class');
    assert.strictEqual(
      await raceModule('t24-noinit'),
      'resolved',
      'a loaded module with nothing to initialise is ready, not pending forever'
    );
  });

  // T25 — PINS THE OPTIONAL CHAIN in `initializeModule`'s no-`init()` early
  // return. That chain shipped in fix round 1 with zero coverage: replacing
  // `?.` with `!` left the suite at 181 pass / 0 fail at f575a3c, so the suite
  // could not tell whether the guard was there.
  //
  // It is load-bearing, on the STANDALONE path. `initializeModule` is reached
  // there as `initializeModule(projectName, …)`, and `projectName` — the root
  // package's own name — is never a key in `modulePromises`, which holds only
  // `@stonyx/`-prefixed declared names. T10 covers the standalone path, but its
  // fixture comes from `moduleSource()`, which always ships an `init()`, so
  // T10 never reaches the early return. Measured directly against this fixture
  // with the `?.` removed: loadModules THREW "Cannot read properties of
  // undefined (reading 'resolve')" — and `stonyx new` can produce this shape.
  //
  // Dies under: `modulePromises[moduleName]?.resolve()` -> `!.resolve()` in the
  // no-`init()` early return.
  test('a standalone root whose class has no init() loads without touching an unregistered promise', async function(assert) {
    const rootPath = root({ name: 'stonyx-t25-standalone', keywords: [ 'stonyx-module' ], main: 'main.js' });
    writeRootFile(rootPath, 'main.js', 'export default class T25Standalone {}\n');

    const modules = await loadModules({}, rootPath, stubChronicle().asChronicle());

    assert.strictEqual(modules.length, 1, 'the standalone root was loaded rather than throwing');
    assert.strictEqual(modules[0]!.constructor.name, 'T25Standalone', 'and instantiated, despite having no init()');
  });

  // T26 — THE SUPERSET DIRECTION of `declaredModuleNames`, which was the one
  // uncovered direction and is the one that prints the declared-but-not-loaded
  // sentence.
  //
  // The subset direction was already caught: seeding
  // `new Set(moduleDependencies.slice(1))` reads 182/1 at c87826b with T23 the
  // sole failure. The other way round was a SURVIVOR — seeding
  // `new Set([ ...moduleDependencies, '@stonyx/ghost' ])` read 183 pass / 0
  // fail at c87826b, because every name the suite asserted the set through was
  // also a name in `moduleDependencies`. Nothing constrained the set from
  // holding a name the app never declared, and that is the branch that tells
  // the operator "It IS declared in this project's dependencies or
  // devDependencies" — i.e. abofs/stonyx#108's names-the-wrong-cause defect,
  // pointed the other way.
  //
  // THE FIXTURE IS THE POINT. `@stonyx/t26-undeclared` is installed under
  // `node_modules` with both keywords and a valid config — everything except a
  // manifest entry. Discovery is driven by the MANIFEST, not by the
  // filesystem, so it is never scanned, never registered, and `waitForModule`
  // must reach the NOT-DECLARED sentence. That kills any superset built from
  // the wrong source: the installed set, the discovered set, a `readdir` of
  // `node_modules`, or the union of this load with a previous one.
  //
  // WHAT IT CANNOT KILL, stated rather than implied: a superset seeded with an
  // arbitrary literal that this fixture does not name. No finite test closes
  // that, and no realistic regression produces it — a wrong SOURCE for the set
  // is the shape that ships, and the source is what this pins.
  //
  // Dies under: any `declaredModuleNames` assignment that admits a name absent
  // from the app's `dependencies` ∪ `devDependencies`.
  test('a name installed but declared in NEITHER map is reported as not declared, not as declared-but-not-loaded', async function(assert) {
    const rootPath = root({
      name: 't26-app',
      dependencies: { '@stonyx/t26-real': '1.0.0' },
    });

    installAsyncModule(rootPath, '@stonyx/t26-real', 'T26Real');
    // Installed and perfectly loadable — and declared nowhere.
    installAsyncModule(rootPath, '@stonyx/t26-undeclared', 'T26Undeclared');

    const capture = captureConsole();
    let modules;

    try {
      modules = await loadModules({}, rootPath, stubChronicle().asChronicle());
    } finally {
      capture.restore();
    }

    assert.strictEqual(
      await raceModule('t26-real'),
      'resolved',
      'premise: the declared module IS discovered, so the loader ran normally over this fixture'
    );
    assert.deepEqual(capture.warnings, [], 'premise: and nothing was skipped — the undeclared package was never even looked at');
    assert.strictEqual(modules.length, 1, 'the undeclared package is not loaded: discovery reads the manifest, not node_modules');

    assert.strictEqual(
      await raceModuleOutcome('t26-undeclared'),
      'rejected: Could wait for module: @stonyx/t26-undeclared. Module was not registered in ' +
      'project dependencies',
      'so waitForModule takes the NOT-DECLARED branch for it'
    );

    const outcome = await raceModuleOutcome('t26-undeclared');

    assert.notOk(
      outcome.includes('It IS declared'),
      `and must not claim the manifest contains it, got: ${outcome}`
    );
  });

  // ---------------------------------------------------------------------
  // F-2 — FLIPPED BY abofs/stonyx#108, exactly as its own comment said it
  // would be. It previously pinned the fact that `loadModules` threw a
  // BYTE-IDENTICAL message for "module ships config/environment.ts" and
  // "module ships no config at all": the relabel at modules.ts:118 discarded
  // `importConfig`'s precise error, attached no `cause`, and let the
  // distinction survive on stderr only, through an unlinked `console.error`.
  //
  // That is invariant I2 failing end-to-end on the module path. #105 restored
  // the distinction inside `importConfig`; #116 corrected the doc sentence and
  // left the code; this is the code. `CONFIG_NOT_LOADABLE_PREFIX` had zero
  // non-test importers in `src/` until now.
  //
  // Runs under plain node because under this suite's own tsx the `.ts` config
  // loads fine and there is no failure to observe at all.
  test('a module shipping config/environment.ts throws a DIFFERENT, causal error from one with no config', async function(assert) {
    const declined = createPlainNodeRoot('f2-declined', {
      'config/environment.ts': 'const config: { port: number } = { port: 7 };\nexport default config;\n',
    });
    const absent = createPlainNodeRoot('f2-absent', {});

    const declinedResult = await loadModulesInPlainNode(declined);
    const absentResult = await loadModulesInPlainNode(absent);

    // Premise: both fixtures must actually fail, or "identical" is vacuous.
    assert.ok(declinedResult.thrown, 'premise: the .ts-config module fails to load');
    assert.ok(absentResult.thrown, 'premise: the no-config module fails to load');

    assert.ok(
      declinedResult.thrown?.message.includes('Config present but not loadable:'),
      `the THROWN error carries the refusal, got: ${declinedResult.thrown?.message}`
    );
    assert.ok(
      declinedResult.thrown?.message.includes('ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING'),
      'and names the Node refusal code'
    );
    assert.notStrictEqual(
      declinedResult.thrown?.message.replace('f2-declined-mod', 'MOD'),
      absentResult.thrown?.message.replace('f2-absent-mod', 'MOD'),
      'and is no longer byte-identical to the no-config case once the module name is normalised'
    );
    assert.ok(
      absentResult.thrown?.message.includes('and none is installed'),
      `the no-config case says so instead, got: ${absentResult.thrown?.message}`
    );

    // The old message is gone from BOTH arms — it was the false claim #108 was
    // filed over, and it was false about the file AND about the module.
    assert.notOk(
      declinedResult.thrown?.message.includes('must have a config/environment.js file'),
      'neither arm still claims a missing config/environment.js'
    );
    assert.notOk(
      absentResult.thrown?.message.includes('must have a config/environment.js file'),
      'including the arm where a config really is absent'
    );

    // Fact 2 for #108: the diagnosis is now reachable programmatically, and it
    // is no longer written to a side channel the caller cannot correlate.
    assert.ok(declinedResult.thrown?.hasCause, 'the rethrow carries a `cause`');
    assert.ok(
      declinedResult.thrown?.causeMessage?.includes('Config present but not loadable:'),
      `and the cause is the loader's own error, got: ${declinedResult.thrown?.causeMessage}`
    );
    assert.deepEqual(declinedResult.stderr, [], 'nothing is logged behind the caller any more');
    assert.deepEqual(absentResult.stderr, [], 'in either arm');
  });
});

module('[Unit] waitForModule', function() {
  // T14 — GUARD. Dies under: invert `if (!modulePromise)` at modules.ts:132.
  test('throws for a module name that was never registered', async function(assert) {
    await assert.rejects(
      waitForModule('t14-nope'),
      new Error('Could wait for module: @stonyx/t14-nope. Module was not registered in project dependencies'),
      'names the module and the reason'
    );
  });
});
