import QUnit from 'qunit';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importConfig } from '../../src/util/import-config.js';

const { module, test, skip } = QUnit;

let dir: string;
let basePath: string;

// abofs/stonyx#90 — config resolution is split on OWNERSHIP, not on extension.
//
//   module-owned (`node_modules/<mod>/config/environment`) -> `.js` ONLY, forever.
//     Node's type-strip loader refuses `.ts` inside node_modules, so a shipped
//     `.ts` config crashes every consumer at parse time (4c80c87 / stonyx-orm#118).
//   app-owned    (`<cwd>/config/environment`, `<root>/test/config/environment`)
//     -> `{ts,js}`, `.ts` preferred, warn when both exist — mirrors
//     `src/util/resolve-entry-point.ts`.
//
// AC1 and the module-owned half of AC4 are REGRESSION GUARDS: they pass at the
// base commit and must keep passing. They are not evidence the story works.

module('[Unit] importConfig — module-owned resolver (.js only)', function(hooks) {
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

  // TODO(#90 AC1) — REGRESSION GUARD, restate against the module-owned export
  //   once the split lands: only `<base>.ts` present must still throw exactly
  //   `Config not found: <base>.js`.
  skip('AC1 [REGRESSION GUARD] module-owned: only .ts present still throws "Config not found: <base>.js"', function(assert) {
    assert.ok(false, 'TODO');
  });

  // TODO(#90 AC4, module-owned half) — REGRESSION GUARD. Already green today;
  //   re-name so the module-owned / app-owned split is legible in TAP output.
  skip('AC4 [REGRESSION GUARD] module-owned: a syntax error inside the resolved config propagates unchanged', function(assert) {
    assert.ok(false, 'TODO');
  });
});

module('[Unit] importConfig — app-owned resolver ({ts,js}, .ts preferred)', function() {
  // TODO(#90 AC2) — restores the test 4c80c87 deleted
  //   (`returns default export when only .ts exists`), re-scoped to app-owned.
  skip('AC2 app-owned: only .ts present resolves and returns its default export', function(assert) {
    assert.ok(false, 'TODO');
  });

  // TODO(#90 AC3) — restores the test 4c80c87 deleted
  //   (`prefers .ts when both exist and logs a warning`), re-scoped to app-owned.
  //   Warning shape must match `resolve-entry-point.ts:13-17`.
  skip('AC3 app-owned: both .ts and .js present resolves the .ts and emits the dual-extension warning', function(assert) {
    assert.ok(false, 'TODO');
  });

  // TODO(#90 AC4, app-owned half) — DEFECT TEST.
  skip('AC4 app-owned: a syntax error inside the resolved config propagates unchanged', function(assert) {
    assert.ok(false, 'TODO');
  });

  // TODO(#90) — app-owned "nothing resolves" must keep the `Config not found:`
  //   prefix that `src/main.ts:70-73` matches on.
  skip('app-owned: neither extension present throws a "Config not found:" error naming {ts,js}', function(assert) {
    assert.ok(false, 'TODO');
  });
});
