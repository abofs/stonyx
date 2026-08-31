import QUnit from 'qunit';
import sinon, { type SinonStub } from 'sinon';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { importConfig } from '../../src/util/import-config.js';
import { importModuleConfig } from '../../src/util/import-module-config.js';

const { module, test } = QUnit;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let dir: string;
let basePath: string;

/**
 * Resolve `basePath` through the BUILT `dist/util/import-config.js` under a
 * plain `node` child.
 *
 * This exists because an in-process assertion CANNOT measure `.ts`-over-`.js`
 * preference. This file runs under `node --import tsx`, and tsx rewrites a
 * `${basePath}.js` specifier to the `.ts` sibling whenever one exists — so the
 * value `importConfig` hands back on a both-siblings pair reads `'ts'` no
 * matter which extension `EXTENSIONS` actually picked. Measured, not reasoned:
 * with `EXTENSIONS` reversed to `['js','ts']` the in-process form of this file
 * stays 9/0 green.
 *
 * The built `dist/util/import-config.js` is a `.js` importer under plain
 * `node`, so no rewrite happens and the answer is the resolver's own.
 * `pnpm test` runs `pnpm build` first, so `dist/` is always current.
 */
function resolveViaBuiltDist(configBase: string): { stdout: string; stderr: string; status: number | null } {
  const importConfigUrl = pathToFileURL(join(repoRoot, 'dist', 'util', 'import-config.js')).href;
  const script = [
    `const { importConfig } = await import(${JSON.stringify(importConfigUrl)});`,
    `const value = await importConfig(${JSON.stringify(configBase)});`,
    `process.stdout.write('SOURCE:' + value.source);`
  ].join('\n');

  const env = { ...process.env };
  delete env.NODE_ENV;
  delete env.NODE_OPTIONS; // pin the isolation explicitly: no tsx in the child, ever

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env,
    timeout: 120000
  });

  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status };
}

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

module('[Unit] importModuleConfig — module-owned resolver (.js only)', function(hooks) {
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
    writeFileSync(`${basePath}.ts`, `const source: string = 'ts';\nexport default { source };\n`);
    writeFileSync(`${basePath}.js`, `export default { source: 'js' };\n`);

    const config = await importConfig<{ source: string }>(basePath);

    // NOT the preference assertion — this one cannot fail. Under `node --import
    // tsx` the `.ts` sibling is substituted for a `.js` specifier, so this reads
    // 'ts' whichever extension the resolver picked. Preference is asserted in
    // the next test, under plain `node`, where it can fail. Do not delete that
    // test on the grounds that this one "already covers .ts wins".
    assert.equal(config.source, 'ts', 'a config was loaded and its default export returned (see the next test for preference)');
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

  // AC3, the half that can actually fail. Identical sibling pair, resolved by
  // the BUILT `dist/util/import-config.js` under plain `node` — no tsx, so no
  // `.js` -> `.ts` specifier rewrite, so the answer is EXTENSIONS' own.
  //
  // Mutation-checked: reversing `EXTENSIONS` to `['js','ts']` in
  // `src/util/extension-resolution.ts` turns THIS test red. The in-process AC3
  // above stays green under the same mutation, which is why both exist.
  //
  // The same property is independently pinned by AC5's precondition in
  // `test/unit/config-resolution-wiring-test.ts` ('APP_OWNED:ts'); neither is
  // redundant — that one guards the wiring, this one is where a reader looking
  // for ".ts wins over .js" arrives.
  test('AC3 [PREFERENCE] .ts wins over .js — asserted under plain node against the built dist/', function(assert) {
    writeFileSync(`${basePath}.ts`, `const source: string = 'ts';\nexport default { source };\n`);
    writeFileSync(`${basePath}.js`, `export default { source: 'js' };\n`);

    const result = resolveViaBuiltDist(basePath);

    assert.equal(result.status, 0, `the probe child exited 0\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`);
    assert.equal(
      result.stdout,
      'SOURCE:ts',
      'the app-owned resolver picked the .ts over an identical .js sibling ' +
      `(a 'SOURCE:js' here means EXTENSIONS no longer prefers .ts)\n--- stderr ---\n${result.stderr}`
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
