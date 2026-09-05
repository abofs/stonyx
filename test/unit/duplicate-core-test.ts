/**
 * Coverage for invariant I1 — "one core" — abofs/stonyx#108.
 *
 * The defect: five sibling repos pin `stonyx` EXACTLY in their own
 * `dependencies`, an exact pin cannot dedupe against a sibling's different
 * exact pin, and the consumer ends up with several framework singletons only
 * one of which is ever `start()`ed. Measured from the `stonyx new` scaffold at
 * `0.2.3-beta.96`: three copies on disk (`0.2.2`, `0.2.3-beta.6`,
 * `0.2.3-beta.11`).
 *
 * Every fixture here installs a REAL second `stonyx` package root under a
 * module's own `node_modules/`, which is the exact tree shape npm and pnpm
 * both produce for that manifest. Nothing is stubbed.
 *
 * Isolation constraint inherited from `modules-test.ts`: `modulePromises`
 * (modules.ts:19) is module-level state with no reset, so every test uses a
 * module name unique to that test.
 */
import QUnit from 'qunit';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import loadModules from '../../src/modules.js';
import { assertDistIsFresh } from '../helpers/dist-freshness.js';
import {
  coreSeenBy,
  duplicateCoreMessage,
  findForeignCores,
  runningCore,
  type ForeignCore,
} from '../../src/util/duplicate-core.js';
import { createRoot, installModule, moduleSource, removeRoot, stubChronicle } from '../helpers/module-fixture.js';

const { module, test } = QUnit;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const execFileAsync = promisify(execFile);
const coreSeenByScript = resolve(dirname(fileURLToPath(import.meta.url)), '../helpers/core-seen-by-plain-node.mjs');

/**
 * Same hard bound as the other subprocess suites in this repo: `execFile` has
 * no default timeout and this repo sets no `QUnit.config.testTimeout`, so an
 * unbounded child hangs the run with no TAP.
 */
const SUBPROCESS_TIMEOUT_MS = 20_000;

/** Runs `coreSeenBy` in a process STARTED with the given NODE_PATH. */
async function coreSeenByWithNodePath(moduleDir: string, nodePath: string): Promise<{ version: string } | null> {
  assertDistIsFresh('coreSeenByWithNodePath');

  const { stdout, stderr } = await execFileAsync('node', [ coreSeenByScript, moduleDir ], {
    timeout: SUBPROCESS_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    env: { ...process.env, NODE_PATH: nodePath },
  });
  const marker = stdout.split('__CORE_SEEN_BY__')[1];

  if (!marker) throw new Error(`probe produced no result. stdout: ${stdout}\nstderr: ${stderr}`);

  return JSON.parse(marker) as { version: string } | null;
}

const roots: string[] = [];

function root(pkg: Record<string, unknown>): string {
  const dir = createRoot(pkg, 'stonyx-dupcore-fixture-');
  roots.push(dir);
  return dir;
}

/**
 * An installed async module. `main.js` WRITES A SENTINEL when it evaluates —
 * that is how the pre-flight tests tell "threw before importing" from "threw
 * while importing", which is the whole point of the check being a pre-flight.
 */
function installFixtureModule(rootPath: string, name: string, className: string): string {
  const sentinel = join(rootPath, `${className}.evaluated`);

  installModule(rootPath, name, { main: 'main.js', keywords: [ 'stonyx-module', 'stonyx-async' ]}, {
    'main.js': `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(sentinel)}, 'yes');\n${moduleSource(className)}`,
    'config/environment.js': 'export default {};\n',
  });

  return sentinel;
}

/** Installs a SECOND physical `stonyx` package root inside `<module>/node_modules`. */
function installNestedCore(rootPath: string, moduleName: string, version: string): string {
  const dir = join(rootPath, 'node_modules', moduleName, 'node_modules', 'stonyx');

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'stonyx', version, type: 'module', main: 'dist/main.js' }));

  return dir;
}

module('[Unit] duplicate-core detector', function(hooks) {
  hooks.afterEach(function() {
    while (roots.length) removeRoot(roots.pop()!);
  });

  // D1 — the negative case, and the control for D2. Without it, D2 proves only
  // that the detector reports SOMETHING, not that it discriminates.
  test('D1: reports nothing when a module resolves the running core', function(assert) {
    const rootPath = root({ name: 'd1-app' });
    installModule(rootPath, '@stonyx/d1-mod', { main: 'main.js', keywords: [ 'stonyx-module' ]});
    // The app's own copy of the core IS this repo. A module with no nested copy
    // walks up to it, exactly as Node would.
    symlinkSync(repoRoot, join(rootPath, 'node_modules', 'stonyx'), 'dir');

    const core = runningCore();
    const seen = coreSeenBy(join(rootPath, 'node_modules', '@stonyx/d1-mod'));

    assert.ok(core, 'premise: the running core identifies itself');
    assert.strictEqual(seen?.root, core?.root, 'the module resolves the same physical package root');
    assert.deepEqual(
      findForeignCores([ { name: '@stonyx/d1-mod', dir: join(rootPath, 'node_modules', '@stonyx/d1-mod') } ]),
      [],
      'and is not reported'
    );
  });

  // D2 — the seeded known-bad. Same fixture as D1 plus one nested package root.
  test('D2: reports a module whose nested copy is a different physical package root', function(assert) {
    const rootPath = root({ name: 'd2-app' });
    installModule(rootPath, '@stonyx/d2-mod', { main: 'main.js', keywords: [ 'stonyx-module' ]});
    symlinkSync(repoRoot, join(rootPath, 'node_modules', 'stonyx'), 'dir');
    installNestedCore(rootPath, '@stonyx/d2-mod', '0.0.0-nested');

    const moduleDir = join(rootPath, 'node_modules', '@stonyx/d2-mod');
    const foreign = findForeignCores([ { name: '@stonyx/d2-mod', dir: moduleDir } ]);

    assert.strictEqual(foreign.length, 1, 'the module is reported');
    assert.strictEqual(foreign[0]?.moduleCore.version, '0.0.0-nested', 'with the version it actually sees');
    assert.strictEqual(
      foreign[0]?.moduleCore.root,
      join(realpathSync(rootPath), 'node_modules', '@stonyx/d2-mod', 'node_modules', 'stonyx'),
      'and the absolute path of the copy it would import (symlinks resolved, as node resolves them)'
    );
    assert.strictEqual(foreign[0]?.runningCore.root, runningCore()?.root, 'alongside the running core');
    assert.notStrictEqual(foreign[0]?.moduleCore.root, foreign[0]?.runningCore.root, 'which is a different path');
  });

  // D7 — the pnpm tree shape, and the control for the realpath narrowing in
  // `coreSeenBy`. `stonyx new` installs with pnpm (src/cli/new.ts:335), so this
  // IS the shape the documented procedure produces: every entry under
  // `node_modules/@stonyx/` is a symlink into the store, and Node resolves that
  // symlink BEFORE resolving the module's own imports.
  //
  // Without the realpath, the walk reads the app's flat `node_modules`, finds
  // the app's own core, and reports nothing — the check passes vacuously on
  // exactly the installer that produces the defect. Measured: with
  // `realPath(moduleDir)` replaced by `moduleDir`, D1-D6 all stay GREEN and
  // only this test reds.
  test('D7: resolves through a pnpm store symlink, not through the flat link path', function(assert) {
    const rootPath = root({ name: 'd7-app' });
    const store = join(rootPath, 'node_modules', '.pnpm', '@stonyx+d7-mod@1.0.0', 'node_modules');

    mkdirSync(join(store, '@stonyx', 'd7-mod'), { recursive: true });
    writeFileSync(
      join(store, '@stonyx', 'd7-mod', 'package.json'),
      JSON.stringify({ name: '@stonyx/d7-mod', version: '1.0.0', type: 'module', main: 'main.js', keywords: [ 'stonyx-module' ]})
    );
    mkdirSync(join(store, 'stonyx'), { recursive: true });
    writeFileSync(
      join(store, 'stonyx', 'package.json'),
      JSON.stringify({ name: 'stonyx', version: '0.0.0-pnpm-nested', type: 'module', main: 'dist/main.js' })
    );

    // The app's flat view: both entries are symlinks, exactly as pnpm writes them.
    mkdirSync(join(rootPath, 'node_modules', '@stonyx'), { recursive: true });
    symlinkSync(repoRoot, join(rootPath, 'node_modules', 'stonyx'), 'dir');
    symlinkSync(join(store, '@stonyx', 'd7-mod'), join(rootPath, 'node_modules', '@stonyx', 'd7-mod'), 'dir');

    const linkPath = join(rootPath, 'node_modules', '@stonyx', 'd7-mod');

    assert.notStrictEqual(realpathSync(linkPath), linkPath, 'premise: the module entry really is a symlink');
    assert.strictEqual(
      coreSeenBy(linkPath)?.version,
      '0.0.0-pnpm-nested',
      'the core is resolved from the store location, which is where node resolves it from'
    );
    assert.strictEqual(
      findForeignCores([ { name: '@stonyx/d7-mod', dir: linkPath } ]).length,
      1,
      'and the module is reported'
    );
  });

  // D3 — FAIL DIRECTION. The guard converts a silent wrong state into a loud
  // one; it must not invent a boot failure out of an inconclusive probe.
  test('D3: fails open — a module that cannot resolve stonyx at all is not reported', function(assert) {
    const rootPath = root({ name: 'd3-app' });
    installModule(rootPath, '@stonyx/d3-mod', { main: 'main.js', keywords: [ 'stonyx-module' ]});
    const moduleDir = join(rootPath, 'node_modules', '@stonyx/d3-mod');

    assert.strictEqual(coreSeenBy(moduleDir), null, 'no core is reachable from the module');
    assert.deepEqual(findForeignCores([ { name: '@stonyx/d3-mod', dir: moduleDir } ]), [], 'and nothing is reported');
    assert.deepEqual(
      findForeignCores([ { name: '@stonyx/d3-mod', dir: moduleDir } ], null),
      [],
      'nor when the running core cannot identify itself either'
    );
  });

  // D8 — CONTROL for the ancestor filter in `coreSeenBy`. `require.resolve.paths`
  // appends the CJS global folders (NODE_PATH, ~/.node_modules, the node
  // prefix) after the node_modules walk. ESM ignores all of them, so honouring
  // them would invent a "duplicate core" out of an environment variable that
  // the real import never consults — turning a boot that works into a refusal.
  //
  // Must run in a subprocess: NODE_PATH is read once at bootstrap into
  // `Module.globalPaths`, so setting `process.env.NODE_PATH` from a test is a
  // check that cannot fail. The premise assertion below is what proves the
  // contaminated environment was actually delivered to the child.
  test('D8: a stonyx reachable only via NODE_PATH is ignored, not reported as a duplicate', async function(assert) {
    const rootPath = root({ name: 'd8-app' });
    installModule(rootPath, '@stonyx/d8-mod', { main: 'main.js', keywords: [ 'stonyx-module' ]});
    symlinkSync(repoRoot, join(rootPath, 'node_modules', 'stonyx'), 'dir');

    const contaminated = root({ name: 'd8-nodepath-store' });
    const ambientCore = join(contaminated, 'stonyx');

    mkdirSync(ambientCore, { recursive: true });
    writeFileSync(
      join(ambientCore, 'package.json'),
      JSON.stringify({ name: 'stonyx', version: '0.0.0-ambient', type: 'module', main: 'dist/main.js' })
    );

    // Premise: a module with NO reachable core is where NODE_PATH would win,
    // and it is the only place the filter is observable at all.
    const isolated = root({ name: 'd8-isolated-app' });
    installModule(isolated, '@stonyx/d8-isolated', { main: 'main.js', keywords: [ 'stonyx-module' ]});

    assert.strictEqual(
      (await coreSeenByWithNodePath(join(rootPath, 'node_modules', '@stonyx/d8-mod'), contaminated))?.version,
      runningCore()?.version,
      'premise: with a real core in the tree, that is what is reported'
    );
    assert.strictEqual(
      await coreSeenByWithNodePath(join(isolated, 'node_modules', '@stonyx/d8-isolated'), contaminated),
      null,
      'and a core reachable only through NODE_PATH is not reported at all'
    );
  });

  // D4 — the message. #108 was filed because the OLD message named a file that
  // was present and a module that had not failed; asserting on the presence of
  // the two resolved paths is the part that cannot be produced by accident.
  test('D4: the diagnostic names the module, both absolute paths, both versions and the remedy', function(assert) {
    const foreign: ForeignCore[] = [ {
      moduleName: '@stonyx/cron',
      moduleCore: { root: '/app/node_modules/@stonyx/cron/node_modules/stonyx', version: '0.2.3-beta.94' },
      runningCore: { root: '/app/node_modules/stonyx', version: '0.2.3-beta.96' },
    } ];
    const message = duplicateCoreMessage(foreign);

    assert.ok(message.includes('@stonyx/cron'), 'names the module');
    assert.ok(message.includes('/app/node_modules/stonyx'), 'names the running core path');
    assert.ok(message.includes('/app/node_modules/@stonyx/cron/node_modules/stonyx'), 'names the module\'s core path');
    assert.ok(message.includes('0.2.3-beta.96'), 'names the running core version');
    assert.ok(message.includes('0.2.3-beta.94'), 'names the module\'s core version');
    assert.ok(message.includes('peerDependencies'), 'gives the module author\'s remedy');
    assert.ok(message.includes('pin stonyx@0.2.3-beta.94'), 'and the consumer\'s interim remedy');
    assert.ok(message.includes('Scope of this check'), 'and states what it does NOT cover');
    assert.notOk(message.includes('config/environment'), 'and never mentions config/environment — that was the false claim');
  });

  // D9 — the copy COUNT and the pin advice, both found wrong by running the
  // check against a real `stonyx new` tree rather than a fixture.
  //
  // `foreign.length + 1` was right on that tree by coincidence (three modules,
  // three different copies) and is wrong whenever two modules share one nested
  // copy — which is the commonest npm shape, since siblings on the same exact
  // pin dedupe with each other. And "pin stonyx@<first foreign version>" is
  // advice that cannot work when the modules disagree among themselves; the
  // message this one replaces was wrong for exactly that reason, so it must
  // not assert more than it knows.
  test('D9: counts DISTINCT roots, and only offers a pin when one version could satisfy every module', function(assert) {
    const runningCore = { root: '/app/node_modules/stonyx', version: '0.2.3-beta.96' };
    const shared = { root: '/app/node_modules/.pnpm/stonyx@0.2.3-beta.94/node_modules/stonyx', version: '0.2.3-beta.94' };

    const agreeing = duplicateCoreMessage([
      { moduleName: '@stonyx/cron', moduleCore: shared, runningCore },
      { moduleName: '@stonyx/orm', moduleCore: shared, runningCore },
    ]);

    assert.ok(agreeing.startsWith('Stonyx: 2 copies'), `two modules on one copy is TWO copies, got: ${agreeing.split('\n')[0]}`);
    assert.ok(agreeing.includes('pin stonyx@0.2.3-beta.94'), 'and one pin does reconcile them');

    const disagreeing = duplicateCoreMessage([
      { moduleName: '@stonyx/cron', moduleCore: shared, runningCore },
      { moduleName: '@stonyx/sockets', moduleCore: { root: '/app/node_modules/.pnpm/stonyx@0.2.3-beta.62/node_modules/stonyx', version: '0.2.3-beta.62' }, runningCore },
    ]);

    assert.ok(disagreeing.startsWith('Stonyx: 3 copies'), `three distinct roots is THREE copies, got: ${disagreeing.split('\n')[0]}`);
    assert.notOk(disagreeing.includes('pin stonyx@'), 'and no pin is offered, because none would work');
    assert.ok(disagreeing.includes('must be republished'), 'the remedy names what would actually fix it');
  });
});

module('[Unit] loadModules pre-flight', function(hooks) {
  hooks.afterEach(function() {
    while (roots.length) removeRoot(roots.pop()!);
  });

  // D5 — the reason this is a PRE-FLIGHT and not a better catch. A module that
  // does not touch `Stonyx.config` at load time never throws; it initialises
  // against a second singleton and reports success. So the assertion is that
  // the entry point was never EVALUATED, with the sentinel's own liveness
  // proven in the same test.
  test('D5: throws before any module entry point is imported', async function(assert) {
    const clean = root({ name: 'd5-clean-app', devDependencies: { '@stonyx/d5-clean': '1.0.0' }});
    const cleanSentinel = installFixtureModule(clean, '@stonyx/d5-clean', 'D5Clean');
    symlinkSync(repoRoot, join(clean, 'node_modules', 'stonyx'), 'dir');

    await loadModules({}, clean, stubChronicle().asChronicle());

    assert.ok(existsSync(cleanSentinel), 'premise: with one core the entry point IS evaluated (sentinel is live)');

    const dup = root({ name: 'd5-dup-app', devDependencies: { '@stonyx/d5-dup': '1.0.0' }});
    const dupSentinel = installFixtureModule(dup, '@stonyx/d5-dup', 'D5Dup');
    symlinkSync(repoRoot, join(dup, 'node_modules', 'stonyx'), 'dir');
    installNestedCore(dup, '@stonyx/d5-dup', '0.0.0-nested');

    let error: Error | undefined;

    try {
      await loadModules({}, dup, stubChronicle().asChronicle());
    } catch (err) {
      error = err as Error;
    }

    assert.ok(error, 'the duplicated tree refuses to boot');
    assert.ok(error?.message.startsWith('Stonyx: 2 copies of the framework are installed'), `got: ${error?.message}`);
    assert.ok(error?.message.includes('0.0.0-nested'), 'and names the version the module would have imported');
    assert.notOk(existsSync(dupSentinel), 'and the module entry point was never evaluated');
  });

  // D6 — the tree #108 measured has THREE copies, not two. Reporting only the
  // first offender makes the consumer fix one pin, re-run, and meet the same
  // failure — the "partial rollout produces no observable improvement" trap.
  test('D6: reports every offending module, not just the first', async function(assert) {
    const rootPath = root({
      name: 'd6-app',
      devDependencies: { '@stonyx/d6-a': '1.0.0', '@stonyx/d6-b': '1.0.0' },
    });
    installFixtureModule(rootPath, '@stonyx/d6-a', 'D6A');
    installFixtureModule(rootPath, '@stonyx/d6-b', 'D6B');
    symlinkSync(repoRoot, join(rootPath, 'node_modules', 'stonyx'), 'dir');
    installNestedCore(rootPath, '@stonyx/d6-a', '0.0.0-a');
    installNestedCore(rootPath, '@stonyx/d6-b', '0.0.0-b');

    let error: Error | undefined;

    try {
      await loadModules({}, rootPath, stubChronicle().asChronicle());
    } catch (err) {
      error = err as Error;
    }

    assert.ok(error?.message.includes('@stonyx/d6-a'), 'names the first offender');
    assert.ok(error?.message.includes('@stonyx/d6-b'), 'and the second');
    assert.ok(error?.message.includes('0.0.0-a') && error?.message.includes('0.0.0-b'), 'with both versions');
    assert.ok(error?.message.startsWith('Stonyx: 3 copies'), `and counts all three copies, got: ${error?.message.split('\n')[0]}`);
  });
});
