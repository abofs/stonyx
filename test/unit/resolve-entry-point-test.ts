import QUnit from 'qunit';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveEntryPoint } from '../../src/util/resolve-entry-point.js';

const { module, test } = QUnit;

let dir: string;
let basePath: string;
let originalWarn: typeof console.warn;
let warnCalls: unknown[][];

function setupWarnSpy(): void {
  originalWarn = console.warn;
  warnCalls = [];
  console.warn = (...args: unknown[]) => { warnCalls.push(args); };
}

function restoreWarn(): void {
  console.warn = originalWarn;
}

module('[Unit] resolveEntryPoint', function(hooks) {
  hooks.beforeEach(function() {
    dir = mkdtempSync(join(tmpdir(), 'stonyx-resolve-entry-point-'));
    basePath = join(dir, 'app');
    setupWarnSpy();
  });

  hooks.afterEach(function() {
    restoreWarn();
    rmSync(dir, { recursive: true, force: true });
  });

  test('resolves to app.ts when only .ts exists', function(assert) {
    writeFileSync(`${basePath}.ts`, `export default class App {}\n`);

    const resolved = resolveEntryPoint(basePath);

    assert.equal(resolved, `${basePath}.ts`, 'returns absolute .ts path');
    assert.equal(warnCalls.length, 0, 'no warning logged');
  });

  test('resolves to app.js when only .js exists', function(assert) {
    writeFileSync(`${basePath}.js`, `export default class App {}\n`);

    const resolved = resolveEntryPoint(basePath);

    assert.equal(resolved, `${basePath}.js`, 'returns absolute .js path');
    assert.equal(warnCalls.length, 0, 'no warning logged');
  });

  test('prefers .ts when both exist and logs a warning', function(assert) {
    writeFileSync(`${basePath}.ts`, `export default class App {}\n`);
    writeFileSync(`${basePath}.js`, `export default class App {}\n`);

    const resolved = resolveEntryPoint(basePath);

    assert.equal(resolved, `${basePath}.ts`, '.ts wins');
    assert.equal(warnCalls.length, 1, 'exactly one warning logged');
    const [[msg]] = warnCalls as [[string]];
    assert.ok(msg.includes('.ts'), 'warning mentions .ts');
    assert.ok(msg.includes('.js'), 'warning mentions .js');
  });

  test('throws clear error when neither exists', function(assert) {
    try {
      resolveEntryPoint(basePath);
      assert.ok(false, 'should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      assert.ok(message.includes('Entry point not found'), 'error mentions "Entry point not found"');
      assert.ok(message.includes('ts') && message.includes('js'), 'error references both extensions');
    }
  });
});
