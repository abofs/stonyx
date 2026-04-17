import QUnit from 'qunit';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const { module, test } = QUnit;

const postinstallScript = resolve(process.cwd(), 'scripts/postinstall.js');

function runPostinstall(initCwd: string) {
  // Run from the stonyx repo root so the script's relative `./config/environment copy.js`
  // source resolves against the real stonyx template.
  execFileSync('node', [postinstallScript], {
    cwd: process.cwd(),
    env: { ...process.env, INIT_CWD: initCwd, npm_config_global: 'false' },
    stdio: 'pipe',
  });
}

module('[Unit] Postinstall', function(hooks) {
  let projectDir: string;

  hooks.beforeEach(function() {
    projectDir = mkdtempSync(join(tmpdir(), 'stonyx-postinstall-'));
  });

  hooks.afterEach(function() {
    rmSync(projectDir, { recursive: true, force: true });
  });

  test('copies environment.js when consumer has no template of its own', function(assert) {
    runPostinstall(projectDir);
    assert.ok(existsSync(join(projectDir, 'config/environment.js')), 'environment.js was created');
  });

  test('skips copy when consumer ships its own `config/environment copy.js` (abofs/stonyx#54)', function(assert) {
    mkdirSync(join(projectDir, 'config'), { recursive: true });
    writeFileSync(join(projectDir, 'config/environment copy.js'), '// consumer template\n');

    runPostinstall(projectDir);

    assert.notOk(
      existsSync(join(projectDir, 'config/environment.js')),
      'environment.js was not created when consumer ships its own template'
    );
  });
});
