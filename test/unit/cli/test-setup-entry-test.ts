/**
 * `stonyx test` boots Stonyx from `dist/cli/test-setup.js` and never imports the
 * app entry (`app.js` / `app.ts`). Consumer docs rely on this: the ORM and cron
 * conventions tell apps that a test registers its own hooks and jobs, because
 * the code `app.js` runs at startup does not run under `stonyx test`.
 *
 * The scratch app's `app.js` and `app.ts` each write a marker file when
 * imported. The test file writes its own marker, which is the positive
 * control: it proves the run reached the tests, so an absent app marker means
 * "not imported", not "the run died first".
 *
 * Inverse (measured when this was written): appending
 * `await import(resolveEntryPoint(`${cwd}/app`))` to `src/cli/test-setup.ts`
 * turns this red on the app-marker assertion.
 */
import QUnit from 'qunit';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { assertDistIsFresh } from '../../helpers/dist-freshness.js';

const { module, test } = QUnit;

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const RUN_TIMEOUT_MS = 30_000;

function buildApp(): string {
  // NEVER a `stonyx-*` name: the standalone transform keys on it.
  const app = mkdtempSync(join(tmpdir(), 'stonyx-test-entry-'));

  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'my-app', version: '0.1.0', type: 'module' }, null, 2));
  mkdirSync(join(app, 'config'), { recursive: true });
  writeFileSync(join(app, 'config', 'environment.js'), 'export default {};\n');

  for (const entry of [ 'app.js', 'app.ts' ]) {
    writeFileSync(
      join(app, entry),
      "import { writeFileSync } from 'node:fs';\n" +
      `writeFileSync(new URL('./${entry}.imported', import.meta.url), '1');\n` +
      'export default class App {}\n'
    );
  }

  mkdirSync(join(app, 'test'), { recursive: true });
  writeFileSync(
    join(app, 'test', 'smoke-test.js'),
    "import { writeFileSync } from 'node:fs';\n" +
    "QUnit.test('smoke', function(assert) {\n" +
    "  writeFileSync(new URL('../tests.ran', import.meta.url), '1');\n" +
    '  assert.ok(true);\n' +
    '});\n'
  );

  // `stonyx test` runs `<cwd>/node_modules/qunit/bin/qunit.js`.
  mkdirSync(join(app, 'node_modules'), { recursive: true });
  symlinkSync(join(repoRoot, 'node_modules', 'qunit'), join(app, 'node_modules', 'qunit'), 'dir');

  return app;
}

module('[Unit] CLI Test Command: app entry', function(hooks) {
  let app: string;

  hooks.before(function() {
    assertDistIsFresh('test-setup-entry');
  });

  hooks.beforeEach(function() {
    app = buildApp();
  });

  hooks.afterEach(function() {
    rmSync(app, { recursive: true, force: true });
  });

  test('stonyx test runs the tests without importing app.js or app.ts', async function(assert) {
    const env: NodeJS.ProcessEnv = { ...process.env };

    // Resolve nothing from an ambient NODE_PATH.
    delete env.NODE_PATH;

    let code = 0;
    let output = '';

    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [ join(repoRoot, 'dist', 'cli.js'), 'test', 'test/**/*-test.js' ],
        { cwd: app, env, timeout: RUN_TIMEOUT_MS, killSignal: 'SIGKILL' }
      );
      output = stdout + stderr;
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      code = typeof failure.code === 'number' ? failure.code : 1;
      output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
    }

    assert.strictEqual(code, 0, `stonyx test exits 0\n${output}`);
    assert.true(existsSync(join(app, 'tests.ran')), 'positive control: the scratch app\'s test ran');
    assert.false(existsSync(join(app, 'app.js.imported')), 'app.js was not imported');
    assert.false(existsSync(join(app, 'app.ts.imported')), 'app.ts was not imported');
  });
});
