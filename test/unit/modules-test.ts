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
import loadModules, { waitForModule } from '../../src/modules.js';
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

  // T2 — GUARD, and the RED baseline abofs/stonyx#106 rule 3 must flip.
  // Dies under M1 inverted (reading `dependencies` would make this module visible).
  //
  // What this pins: `loadModules` reads `devDependencies` only (modules.ts:55),
  // so a real, installed stonyx module declared in `dependencies` is invisible
  // to discovery. That is today's contract. It is not a desirable one.
  //
  // #106 rule 3 changes it — discovery scans `dependencies` ∪ `devDependencies`.
  // This test is the RED baseline proving that change actually landed, and #106
  // MUST invert it inside #106's own diff. Measured across all three plausible
  // rule-3 shapes, T2 is the SOLE failure in the suite, so there is no rule-3
  // implementation that leaves it green.
  //
  // Flipping it correctly, in #106, means INVERTING the assertions on this same
  // fixture — not deleting the test, not skipping it, and not weakening it to
  // `assert.ok(true)`. Under rule 3 the same root must yield:
  //     modules.length === 1, modules[0].constructor.name === 'T2Beta'
  //     Object.keys(config) === [ 'rootPath', 't2Beta' ]  (config block added)
  //     (config.t2Beta as Record<string, unknown>).port === 2
  // and the title should drop "flipped by #106". If you are reading this from
  // inside #106 because this test went red: that red is the intended signal.
  test('ignores modules declared only in dependencies (today’s contract, flipped by #106)', async function(assert) {
    const rootPath = root({ name: 't2-app', dependencies: { '@stonyx/t2-beta': '1.0.0' }});
    installAsyncModule(rootPath, '@stonyx/t2-beta', 'T2Beta', { port: 2 });

    const config: StoynxConfig = {};
    const modules = await loadModules(config, rootPath, stubChronicle().asChronicle());

    assert.deepEqual(modules, [], 'a dependencies-only stonyx module is invisible to discovery');
    assert.deepEqual(Object.keys(config), [ 'rootPath' ], 'no module config block was added');
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
  // this head, both mutants read 97/1 with this test the sole failure.
  //
  // Both were invisible because every negative fixture was UNSCOPED (`lodash`,
  // `my-stonyx-thing`), so nothing in the suite distinguished "only @stonyx/"
  // from "only scoped". `@types/node` is the scoped non-stonyx fixture that
  // does; it is in this repo's own devDependencies, so it is exactly what a
  // real consumer manifest looks like. It is load-bearing for the
  // `startsWith('@')` widening SPECIFICALLY: delete that one fixture line and
  // that mutant goes back to 98/0 SURVIVED, while drop-the-filter stays killed
  // at 97/1 -- an unfiltered list also stats `lodash` and `my-stonyx-thing`,
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

  // T9 — GUARD, and pins F4: the thrown message blames a missing
  // config/environment.js even when the config file is present and the real
  // failure is something else. Dies under: delete `console.error(error)` at modules.ts:117.
  test('relabels an async module load failure but logs the underlying error', async function(assert) {
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

    assert.strictEqual(
      (error as Error | undefined)?.message,
      'Stonyx modules with async loading must have a config/environment.js file with default configurations. Module "@stonyx/t9-nomain" failed to load.',
      'the thrown message names config/environment.js (which exists) — F4, pinned as-is'
    );
    assert.strictEqual(capture.errors.length, 1, 'the underlying error was logged');
    assert.strictEqual(
      (capture.errors[0] as NodeJS.ErrnoException | undefined)?.code,
      'ERR_MODULE_NOT_FOUND',
      'and the underlying failure is a missing entry point, not a missing config'
    );
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
  //     T2 inverted + correct rule 3                     98/0
  //     T2 inverted + desync + `?.` at modules.ts:97     98/0  — IDENTICAL
  // The second of those ships a rule 3 where every `dependencies`-declared
  // module loads and `waitForModule` on it throws "was not registered"
  // forever, with the suite fully green. The line above splits them: still
  // 98/0 under a correct rule 3, but 97/1 with this test the SOLE failure
  // under the desync, rejecting with "Could wait for module:
  // @stonyx/t21-sync. Module was not registered in project dependencies".
  //
  // And if this test reds at `:97` inside #106, adding `?.` there is NOT the
  // fix. `modules.ts:43` already carries that exact optional chain three lines
  // from `initializeModule`, so it is the first thing to hand — and it only
  // converts a loud TypeError into a promise that is registered nowhere and
  // resolves never. The fix is to make the registration loop at `:66` consume
  // the same list as `:61`.
  //
  // The invariant line cannot be added HERE. Measured at this head with no
  // rule 3, it reds this test (97/1, sole failure): `t21-sync` is legitimately
  // never registered today. It only becomes meaningful once rule 3 lands,
  // which is why this is a note and not an assertion.
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

  // T13 — HAZARD GUARD, not a defect test. It pins F1: the two `continue`
  // paths in loadModules leave `modulePromises[name]` permanently unresolved,
  // so `waitForModule` hangs forever with only a stderr warning. This is a
  // known hazard filed separately; the guard exists so a fix is a deliberate,
  // visible change rather than a silent one.
  // Dies under: resolve the promise before the `continue` at modules.ts:93.
  test('hazard guard (F1): a keyword-rejected module leaves waitForModule hanging forever', async function(assert) {
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

    assert.strictEqual(
      await raceModule('t13-nokey'),
      'TIMEOUT',
      'the keyword-rejected module never resolves (F1, pinned as-is)'
    );
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
