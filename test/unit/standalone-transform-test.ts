import QUnit from 'qunit';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveModuleName } from '../../src/util/resolve-module-name.js';

const { module, test } = QUnit;

let dir: string;

/**
 * Apply the standalone-config transform exactly as `Stonyx.start` does:
 * if `resolveModuleName` returns a name, wrap the flat config under it and
 * merge any sibling `config.modules`. Returns the (possibly-transformed)
 * config so tests can assert on shape without spinning up a Stonyx instance.
 */
function applyStandaloneTransform(
  rawConfig: Record<string, unknown>,
  rootPath: string
): Record<string, unknown> {
  const moduleName = resolveModuleName(rootPath);
  if (!moduleName) return rawConfig;

  const siblingModules = (rawConfig.modules as Record<string, unknown>) || {};
  const wrapped: Record<string, unknown> = { [moduleName]: rawConfig, ...siblingModules };
  delete wrapped.modules;
  return wrapped;
}

module('[Unit] standalone-transform', function(hooks) {
  hooks.beforeEach(function() {
    dir = mkdtempSync(join(tmpdir(), 'stonyx-standalone-transform-'));
  });

  hooks.afterEach(function() {
    rmSync(dir, { recursive: true, force: true });
  });

  test('scoped @stonyx/rest-server name wraps config under restServer at arbitrary rootPath', function(assert) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@stonyx/rest-server' }));

    const result = applyStandaloneTransform({ port: 3000 }, dir);

    assert.deepEqual(result, { restServer: { port: 3000 } }, 'wrapped under restServer');
  });

  test('unscoped stonyx-rest-server name wraps config under restServer at arbitrary rootPath', function(assert) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'stonyx-rest-server' }));

    const result = applyStandaloneTransform({ port: 3000 }, dir);

    assert.deepEqual(result, { restServer: { port: 3000 } }, 'wrapped under restServer');
  });

  test('non-stonyx name (my-app) leaves config flat, no transform', function(assert) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'my-app' }));

    const input = { port: 3000, someFlag: true };
    const result = applyStandaloneTransform(input, dir);

    assert.strictEqual(result, input, 'returns the original config reference');
    assert.deepEqual(result, { port: 3000, someFlag: true }, 'config shape unchanged');
  });

  test('missing package.json leaves config flat, does not throw', function(assert) {
    const input = { port: 3000 };

    let result: Record<string, unknown> | undefined;
    try {
      result = applyStandaloneTransform(input, dir);
    } catch (err) {
      assert.ok(false, `should not throw, got: ${(err as Error).message}`);
      return;
    }

    assert.strictEqual(result, input, 'returns the original config reference');
    assert.deepEqual(result, { port: 3000 }, 'config shape unchanged');
  });

  test('malformed package.json (invalid JSON) leaves config flat, does not throw', function(assert) {
    writeFileSync(join(dir, 'package.json'), '{ this is not valid JSON !!! ');

    const input = { port: 3000 };

    let result: Record<string, unknown> | undefined;
    try {
      result = applyStandaloneTransform(input, dir);
    } catch (err) {
      assert.ok(false, `should not throw, got: ${(err as Error).message}`);
      return;
    }

    assert.strictEqual(result, input, 'returns the original config reference');
    assert.deepEqual(result, { port: 3000 }, 'config shape unchanged');
  });

  test('sibling config.modules merges into wrapped result as siblings of the wrapped key', function(assert) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@stonyx/rest-server' }));

    const input: Record<string, unknown> = {
      port: 3000,
      modules: {
        other: { enabled: true, endpoint: '/foo' },
      },
    };

    const result = applyStandaloneTransform(input, dir);

    assert.ok(result.restServer, 'has restServer key');
    assert.deepEqual(
      (result.restServer as Record<string, unknown>).port,
      3000,
      'flat config values live under restServer'
    );
    assert.deepEqual(
      result.other,
      { enabled: true, endpoint: '/foo' },
      'sibling modules merged at the top level'
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
