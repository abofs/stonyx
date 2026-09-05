/**
 * Coverage for the standalone-config transform in `Stonyx.start`
 * (`src/main.ts:50-56`) and for `resolveModuleName`. See abofs/stonyx#109.
 *
 * These tests previously ran against a test-local re-implementation of the
 * transform. That copy has been deleted: mutation showed the real transform
 * could be reverted to the pre-#104 heuristic, or removed outright, with this
 * file fully green. Each scenario now performs a real `new Stonyx(...)` +
 * `await Stonyx.ready`.
 *
 * Each boot runs in its own subprocess. `Stonyx` is a process-global singleton
 * (`main.ts:36` returns instance #1 for every later construction, and
 * `Stonyx.initialized` never resets), so an in-process rewrite would assert
 * five of these six cases against boot #1's config. `main-test.ts` also asserts
 * the pre-initialisation throw, which any in-process boot would destroy.
 *
 * Directory-name prefixes are load-bearing (#109 AC2). The pre-#104 heuristic
 * keyed off `rootPath.includes('stonyx-')`, so:
 *   - a `stonyx-` prefixed root catches it firing when it should not;
 *   - a non-`stonyx-` root catches it failing to fire, which is the actual
 *     defect #104 fixed (worktrees, forks, renames — stonyx#71).
 * Both directions are required; either alone reads as complete and is not.
 *
 * All tests are GUARDS: #109 changes no production behaviour.
 */
import QUnit from 'qunit';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { resolveModuleName } from '../../src/util/resolve-module-name.js';

const { module, test } = QUnit;

const execFileAsync = promisify(execFile);
const bootScript = resolve(dirname(fileURLToPath(import.meta.url)), '../helpers/boot-stonyx.ts');

/** Root directory name CONTAINS `stonyx-` — sees the pre-#104 heuristic fire. */
const STONYX_PREFIX = 'stonyx-standalone-boot-';
/** Root directory name does NOT contain `stonyx-` — sees it fail to fire. */
const PLAIN_PREFIX = 'standalone-boot-';

interface BootResult {
  bootError: string | null;
  config: Record<string, unknown> | null;
}

let dir: string;

function makeRoot(prefix: string, pkg?: string): string {
  dir = mkdtempSync(join(tmpdir(), prefix));
  if (pkg !== undefined) writeFileSync(join(dir, 'package.json'), pkg);
  return dir;
}

async function boot(rootPath: string, config: Record<string, unknown>): Promise<BootResult> {
  const { stdout, stderr } = await execFileAsync(
    'node',
    [ '--import', 'tsx', bootScript, rootPath, JSON.stringify(config) ],
    { env: { ...process.env, NODE_ENV: 'test' }}
  );

  const marker = stdout.split('__STONYX_BOOT__')[1];
  if (!marker) throw new Error(`boot produced no result. stdout: ${stdout}\nstderr: ${stderr}`);

  return JSON.parse(marker) as BootResult;
}

function keys(config: Record<string, unknown> | null): string[] {
  return Object.keys(config ?? {}).sort();
}

module('[Unit] standalone-transform', function(hooks) {
  hooks.afterEach(function() {
    rmSync(dir, { recursive: true, force: true });
  });

  // T15 — AC2 row C: scoped name in a root whose directory name has NO
  // `stonyx-` in it. The pre-#104 heuristic returns null here, so this is the
  // case that catches it failing to fire. Dies under S1, S2f and S3.
  test('scoped @stonyx/rest-server wraps config under restServer from a non-stonyx- rootPath', async function(assert) {
    const rootPath = makeRoot(PLAIN_PREFIX, JSON.stringify({ name: '@stonyx/rest-server' }));

    const { bootError, config } = await boot(rootPath, { port: 3000 });

    assert.strictEqual(bootError, null, 'boot succeeded');
    assert.deepEqual(config!.restServer, { port: 3000 }, 'flat config wrapped under restServer');
    assert.deepEqual(keys(config), [ 'restServer', 'rootPath' ], 'and nothing else is at the top level');
  });

  // T16 — AC2 row A: unscoped name in a `stonyx-` prefixed root. Dies under
  // S1, S2f (which derives the key from the directory name, not the package
  // name) and S3.
  test('unscoped stonyx-rest-server wraps config under restServer from a stonyx- rootPath', async function(assert) {
    const rootPath = makeRoot(STONYX_PREFIX, JSON.stringify({ name: 'stonyx-rest-server' }));

    const { bootError, config } = await boot(rootPath, { port: 3000 });

    assert.strictEqual(bootError, null, 'boot succeeded');
    assert.deepEqual(config!.restServer, { port: 3000 }, 'flat config wrapped under restServer');
    assert.deepEqual(keys(config), [ 'restServer', 'rootPath' ], 'and nothing else is at the top level');
  });

  // T17 — AC2 row B: non-stonyx package name in a `stonyx-` prefixed root.
  // This is the case that catches the pre-#104 heuristic firing when it should
  // not. Flatness is asserted by the absence of a wrapper key: reference
  // identity cannot cross a process boundary. Dies under S2f.
  test('non-stonyx name leaves config flat even from a stonyx- rootPath', async function(assert) {
    const rootPath = makeRoot(STONYX_PREFIX, JSON.stringify({ name: 'my-app' }));

    const { bootError, config } = await boot(rootPath, { port: 3000, someFlag: true });

    assert.strictEqual(bootError, null, 'boot succeeded');
    assert.deepEqual(keys(config), [ 'port', 'rootPath', 'someFlag' ], 'config stayed flat, no wrapper key');
    assert.strictEqual(config!.port, 3000, 'values are unchanged');
    assert.strictEqual(config!.someFlag, true, 'values are unchanged');
  });

  // T18 — missing package.json in a `stonyx-` prefixed root: the transform is
  // skipped silently. The boot still fails, but downstream in `loadModules`,
  // which reads the same file with no missing-file callback (modules.ts:54) —
  // asserted here so the failure is attributed to the right layer. Dies under S2f.
  test('missing package.json leaves config flat from a stonyx- rootPath', async function(assert) {
    const rootPath = makeRoot(STONYX_PREFIX);

    const { bootError, config } = await boot(rootPath, { port: 3000 });

    assert.deepEqual(keys(config), [ 'port' ], 'config stayed flat, no wrapper key');
    assert.true(
      bootError?.startsWith('ENOENT') ?? false,
      `the transform did not throw; loadModules did, on the same missing file. Got: ${bootError}`
    );
  });

  // T19 — malformed package.json in a `stonyx-` prefixed root: `resolveModuleName`
  // swallows the parse error and skips the transform. `loadModules` then fails on
  // the same file. Dies under S2f.
  test('malformed package.json leaves config flat from a stonyx- rootPath', async function(assert) {
    const rootPath = makeRoot(STONYX_PREFIX, '{ this is not valid JSON !!! ');

    const { bootError, config } = await boot(rootPath, { port: 3000 });

    assert.deepEqual(keys(config), [ 'port' ], 'config stayed flat, no wrapper key');
    assert.true(
      (bootError?.includes('JSON') ?? false),
      `the transform did not throw; loadModules did, parsing the same file. Got: ${bootError}`
    );
  });

  // T20 — AC2 row C with siblings: `config.modules` entries are hoisted to sit
  // beside the wrapped key. Dies under S1, S2f and S3.
  test('sibling config.modules merge as siblings of the wrapped key', async function(assert) {
    const rootPath = makeRoot(PLAIN_PREFIX, JSON.stringify({ name: '@stonyx/rest-server' }));

    const { bootError, config } = await boot(rootPath, {
      port: 3000,
      modules: { other: { enabled: true, endpoint: '/foo' }},
    });

    assert.strictEqual(bootError, null, 'boot succeeded');
    assert.deepEqual(keys(config), [ 'other', 'restServer', 'rootPath' ], 'siblings sit beside the wrapped key');
    assert.deepEqual(config!.other, { enabled: true, endpoint: '/foo' }, 'sibling config is carried over intact');
    assert.strictEqual(
      (config!.restServer as Record<string, unknown>).port,
      3000,
      'flat config values live under restServer'
    );
    // Measured, pinned as-is: `delete config.modules` (main.ts:55) runs against
    // the NEW outer object, which has no `modules` key — so the original
    // `modules` block survives inside the wrapped config.
    assert.deepEqual(
      Object.keys(config!.restServer as Record<string, unknown>).sort(),
      [ 'modules', 'port' ],
      'the source `modules` block is not removed from the wrapped config'
    );
  });
});

module('[Unit] resolveModuleName', function(hooks) {
  hooks.beforeEach(function() {
    dir = mkdtempSync(join(tmpdir(), 'stonyx-resolve-module-name-'));
  });

  hooks.afterEach(function() {
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns camelCase for scoped @stonyx/<kebab>', function(assert) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@stonyx/rest-server' }));

    assert.equal(resolveModuleName(dir), 'restServer');
  });

  test('returns camelCase for unscoped stonyx-<kebab>', function(assert) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'stonyx-rest-server' }));

    assert.equal(resolveModuleName(dir), 'restServer');
  });

  test('returns null for non-stonyx name', function(assert) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'my-app' }));

    assert.strictEqual(resolveModuleName(dir), null);
  });

  test('returns null when package.json is missing', function(assert) {
    assert.strictEqual(resolveModuleName(dir), null);
  });

  test('returns null when package.json is malformed', function(assert) {
    writeFileSync(join(dir, 'package.json'), '{ not valid JSON');

    assert.strictEqual(resolveModuleName(dir), null);
  });

  test('returns null when name field is missing', function(assert) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.0.0' }));

    assert.strictEqual(resolveModuleName(dir), null);
  });
});
