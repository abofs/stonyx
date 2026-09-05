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

/*
 * ============================================================================
 * abofs/stonyx#105 — SCAFFOLD. Every stub below is one acceptance criterion
 * from the refinement comment on #105 / SPRINT-93-BOOT-CLUSTER.md §3.
 *
 * These are `QUnit.todo` — they are REQUIRED to fail while unimplemented and
 * flip to a hard failure the moment they start passing, so a stub cannot be
 * left behind silently.
 *
 * AC1 — the loader accepts `.ts` and prefers it.
 * AC2 — present-and-unread is distinguishable from absent, and `main.ts`'s
 *       test-override catch does NOT swallow it (invariant I2).
 * AC4 — a genuinely absent test override stays non-fatal (over-correction guard).
 * ============================================================================
 */
module('[Unit] importConfig — #105 scaffold', function() {
  // AC1
  QUnit.todo('AC1-a: loads the default export when only .ts exists', function(assert) {
    assert.ok(false, 'TODO(#105): restore .ts support in importConfig');
  });

  QUnit.todo('AC1-b: prefers .ts when both .ts and .js exist, and warns', function(assert) {
    assert.ok(false, 'TODO(#105): restore the beta.62 both-present warning');
  });

  QUnit.todo('AC1-c: the "not found" message names both extensions, not just .js', function(assert) {
    assert.ok(false, 'TODO(#105): message becomes `Config not found: <base>.{ts,js}`');
  });

  // AC1 — the flip. `test/unit/import-config-test.ts:32-42` currently pins
  // `.ts is not a supported extension`. It must be INVERTED in this diff, not
  // deleted; AC1-a above is its replacement.
  QUnit.todo('AC1-d: the committed `.ts is not a supported extension` assertion is inverted in this diff', function(assert) {
    assert.ok(false, 'TODO(#105): flip the committed test that pins the wrong contract');
  });

  // AC2 — invariant I2: no silent decline.
  QUnit.todo('AC2-a: a config present at an extension the loader will not read throws a message distinct from "Config not found:"', function(assert) {
    assert.ok(false, 'TODO(#105): add the present-but-not-loadable branch');
  });

  QUnit.todo('AC2-b: a .ts config Node refuses to type-strip (inside node_modules) is a loud failure, not "Config not found:"', function(assert) {
    assert.ok(false, 'TODO(#105): convert Node file-type refusals into the loud error');
  });

  QUnit.todo('AC2-c: main.ts\'s NODE_ENV=test catch RE-THROWS the present-but-not-loadable error', function(assert) {
    assert.ok(false, 'TODO(#105): assert the re-throw through a real boot, not on stdout');
  });

  QUnit.todo('AC2-d: absent-vs-declined stay distinguishable in BOTH directions', function(assert) {
    assert.ok(false, 'TODO(#105): the truly-absent case must still read "Config not found:"');
  });

  // AC4 — over-correction guard.
  QUnit.todo('AC4: a root with NO test/config/environment.* still boots under NODE_ENV=test', function(assert) {
    assert.ok(false, 'TODO(#105): missing test override must stay non-fatal');
  });

  QUnit.todo('AC4-b: a .ts test override is merged under NODE_ENV=test (the fleet-facing case)', function(assert) {
    assert.ok(false, 'TODO(#105): this is what beta.82+ silently stopped doing across 4 repos');
  });
});
