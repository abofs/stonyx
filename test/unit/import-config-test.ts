import QUnit from 'qunit';
import sinon, { type SinonStub } from 'sinon';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importConfig } from '../../src/util/import-config.js';
import { importModuleConfig } from '../../src/util/import-module-config.js';

const { module, test } = QUnit;

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
// base commit (e57b99b) and must keep passing. They are not evidence the story
// works — they are evidence it did not break what 4c80c87 fixed.

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

    const config = await importModuleConfig<{ source: string; port: number }>(basePath);

    assert.equal(config.source, 'js');
    assert.equal(config.port, 4000);
  });

  // AC1 — REGRESSION GUARD. Green at base, green at head.
  test('AC1 [REGRESSION GUARD] throws "Config not found: *.js" when only .ts exists', async function(assert) {
    writeFileSync(`${basePath}.ts`, `export default { source: 'ts' };\n`);

    try {
      await importModuleConfig(basePath);
      assert.ok(false, 'should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      assert.equal(message, `Config not found: ${basePath}.js`, '4c80c87 message is unchanged, byte for byte');
      assert.ok(message.endsWith('.js'), 'error references .js (not .ts)');
      assert.notOk(message.includes('.ts'), '.ts is not a supported extension');
    }
  });

  test('throws "Config not found: *.js" when neither exists', async function(assert) {
    try {
      await importModuleConfig(basePath);
      assert.ok(false, 'should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      assert.ok(message.startsWith('Config not found'), 'error starts with "Config not found"');
      assert.ok(message.endsWith('.js'), 'error references .js');
    }
  });

  // AC4, module-owned half — REGRESSION GUARD. Green at base, green at head.
  test('AC4 [REGRESSION GUARD] propagates non-"not found" import errors (syntax error)', async function(assert) {
    writeFileSync(`${basePath}.js`, `export default { this is invalid syntax !!! };\n`);

    try {
      await importModuleConfig(basePath);
      assert.ok(false, 'should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      assert.notOk(message.startsWith('Config not found'), 'not the "not found" error');
      assert.ok(message.length > 0, 'has an error message');
    }
  });
});

module('[Unit] importConfig — app-owned resolver ({ts,js}, .ts preferred)', function(hooks) {
  hooks.beforeEach(function() {
    dir = mkdtempSync(join(tmpdir(), 'stonyx-import-config-app-'));
    basePath = join(dir, 'environment');
  });

  hooks.afterEach(function() {
    sinon.restore();
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns default export when only .js exists', async function(assert) {
    writeFileSync(`${basePath}.js`, `export default { source: 'js', port: 4000 };\n`);

    const config = await importConfig<{ source: string; port: number }>(basePath);

    assert.equal(config.source, 'js');
    assert.equal(config.port, 4000);
  });

  // AC2 — restores the test 4c80c87 deleted (`returns default export when only
  // .ts exists`), re-scoped to app-owned. Not a revert: the module-owned half
  // above keeps 4c80c87's behaviour byte for byte.
  test('AC2 returns default export when only .ts exists', async function(assert) {
    const warnStub: SinonStub = sinon.stub(console, 'warn');
    writeFileSync(`${basePath}.ts`, `export default { source: 'ts', port: 5000 };\n`);

    const config = await importConfig<{ source: string; port: number }>(basePath);

    assert.equal(config.source, 'ts', 'resolved the .ts and returned its default export');
    assert.equal(config.port, 5000);
    assert.equal(warnStub.callCount, 0, 'no dual-extension warning when only one extension exists');
  });

  // AC3 — restores the test 4c80c87 deleted (`prefers .ts when both exist and
  // logs a warning`), re-scoped to app-owned. The message is built by
  // `dualExtensionWarning` in `src/util/extension-resolution.ts`, shared with
  // `resolveEntryPoint`; it is pinned here as a literal so a reword goes red.
  test('AC3 prefers .ts when both exist and logs the dual-extension warning', async function(assert) {
    const warnStub: SinonStub = sinon.stub(console, 'warn');
    writeFileSync(`${basePath}.ts`, `export default { source: 'ts' };\n`);
    writeFileSync(`${basePath}.js`, `export default { source: 'js' };\n`);

    const config = await importConfig<{ source: string }>(basePath);

    assert.equal(config.source, 'ts', '.ts wins over .js');
    assert.equal(warnStub.callCount, 1, 'warned exactly once');

    // Byte-for-byte the shape resolve-entry-point.ts emits, with "Entry point"
    // swapped for the config base path. Asserted as a whole string so a
    // reworded message cannot pass on a substring.
    assert.equal(
      warnStub.firstCall.args[0],
      `Warning: both ${basePath}.ts and ${basePath}.js exist. Using .ts — delete the .js to silence this warning ` +
      '(it is likely a stale compiled artifact or postinstall stub).',
      'warning matches dualExtensionWarning() in src/util/extension-resolution.ts, byte for byte'
    );
  });

  // AC4, app-owned half — DEFECT TEST (red at base: the .ts never resolves there).
  test('AC4 propagates non-"not found" import errors (syntax error in a .ts)', async function(assert) {
    writeFileSync(`${basePath}.ts`, `export default { this is invalid syntax !!! };\n`);

    try {
      await importConfig(basePath);
      assert.ok(false, 'should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      assert.notOk(message.startsWith('Config not found'), 'not the "not found" error');
      assert.ok(message.length > 0, 'has an error message');
    }
  });

  test('throws a "Config not found:" error naming {ts,js} when neither exists', async function(assert) {
    try {
      await importConfig(basePath);
      assert.ok(false, 'should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      // src/main.ts:70-73 matches on this exact prefix to tell an absent
      // optional test override from a real import failure.
      assert.ok(message.startsWith('Config not found:'), 'keeps the prefix main.ts matches on');
      assert.equal(message, `Config not found: ${basePath}.{ts,js}`, 'names both supported extensions');
    }
  });
});
