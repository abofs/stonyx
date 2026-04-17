import QUnit from 'qunit';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importConfig } from '../../src/util/import-config.js';

const { module, test } = QUnit;

let dir: string;
let basePath: string;

module('[Unit] importConfig', function(hooks) {
  hooks.beforeEach(function() {
    // Unique subdir per test so module import cache can't collide across tests
    dir = mkdtempSync(join(tmpdir(), 'stonyx-import-config-'));
    basePath = join(dir, 'environment');
  });

  hooks.afterEach(function() {
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns default export when only .js exists', async function(assert) {
    writeFileSync(`${basePath}.js`, `export default { source: 'js', port: 4000 };\n`);

    const config = await importConfig<{ source: string; port: number }>(basePath);

    assert.equal(config.source, 'js');
    assert.equal(config.port, 4000);
  });

  test('throws "Config not found: *.js" when only .ts exists', async function(assert) {
    writeFileSync(`${basePath}.ts`, `export default { source: 'ts' };\n`);

    try {
      await importConfig(basePath);
      assert.ok(false, 'should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      assert.ok(message.startsWith('Config not found'), 'error starts with "Config not found"');
      assert.ok(message.endsWith('.js'), 'error references .js (not .ts)');
      assert.notOk(message.includes('.ts'), '.ts is not a supported extension');
    }
  });

  test('throws "Config not found: *.js" when neither exists', async function(assert) {
    try {
      await importConfig(basePath);
      assert.ok(false, 'should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      assert.ok(message.startsWith('Config not found'), 'error starts with "Config not found"');
      assert.ok(message.endsWith('.js'), 'error references .js');
    }
  });

  test('propagates non-"not found" import errors (syntax error)', async function(assert) {
    writeFileSync(`${basePath}.js`, `export default { this is invalid syntax !!! };\n`);

    try {
      await importConfig(basePath);
      assert.ok(false, 'should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      assert.notOk(message.startsWith('Config not found'), 'not the "not found" error');
      assert.ok(message.length > 0, 'has an error message');
    }
  });
});
