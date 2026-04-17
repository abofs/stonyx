import QUnit from 'qunit';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const { module, test } = QUnit;

const postinstallScript = resolve(process.cwd(), 'scripts/postinstall.js');

function runPostinstall(initCwd: string) {
  // Run from the stonyx repo root so the script's relative `./config/environment copy.*`
  // source resolves against the real stonyx template.
  execFileSync('node', [postinstallScript], {
    cwd: process.cwd(),
    env: { ...process.env, INIT_CWD: initCwd, npm_config_global: 'false' },
    stdio: 'pipe',
  });
}

function writeTsconfig(projectDir: string) {
  writeFileSync(join(projectDir, 'tsconfig.json'), '{}\n');
}

module('[Unit] Postinstall', function(hooks) {
  let projectDir: string;

  hooks.beforeEach(function() {
    projectDir = mkdtempSync(join(tmpdir(), 'stonyx-postinstall-'));
  });

  hooks.afterEach(function() {
    rmSync(projectDir, { recursive: true, force: true });
  });

  test('copies environment.ts when consumer has tsconfig.json and no template of its own', function(assert) {
    writeTsconfig(projectDir);

    runPostinstall(projectDir);

    assert.ok(existsSync(join(projectDir, 'config/environment.ts')), 'environment.ts was created');
    assert.notOk(existsSync(join(projectDir, 'config/environment.js')), 'environment.js was NOT created');
  });

  test('copies environment.js when consumer has no tsconfig.json and no template of its own', function(assert) {
    runPostinstall(projectDir);

    assert.ok(existsSync(join(projectDir, 'config/environment.js')), 'environment.js was created');
    assert.notOk(existsSync(join(projectDir, 'config/environment.ts')), 'environment.ts was NOT created');
  });

  test('skips copy when consumer ships its own `config/environment copy.js` (abofs/stonyx#54 back-compat)', function(assert) {
    mkdirSync(join(projectDir, 'config'), { recursive: true });
    writeFileSync(join(projectDir, 'config/environment copy.js'), '// consumer template\n');

    runPostinstall(projectDir);

    assert.notOk(
      existsSync(join(projectDir, 'config/environment.js')),
      'environment.js was not created when consumer ships its own .js template'
    );
    assert.notOk(
      existsSync(join(projectDir, 'config/environment.ts')),
      'environment.ts was not created when consumer ships its own .js template'
    );
  });

  test('skips copy when consumer ships its own `config/environment copy.ts` (abofs/stonyx#62 extended sentinel)', function(assert) {
    writeTsconfig(projectDir);
    mkdirSync(join(projectDir, 'config'), { recursive: true });
    writeFileSync(join(projectDir, 'config/environment copy.ts'), '// consumer template\n');

    runPostinstall(projectDir);

    assert.notOk(
      existsSync(join(projectDir, 'config/environment.ts')),
      'environment.ts was not created when consumer ships its own .ts template'
    );
    assert.notOk(
      existsSync(join(projectDir, 'config/environment.js')),
      'environment.js was not created when consumer ships its own .ts template'
    );
  });

  test('skips copy when consumer already has a `config/environment.ts` (no overwrite)', function(assert) {
    writeTsconfig(projectDir);
    mkdirSync(join(projectDir, 'config'), { recursive: true });
    writeFileSync(join(projectDir, 'config/environment.ts'), '// existing consumer config\n');

    runPostinstall(projectDir);

    // Content should be unchanged: no fresh template was copied over top.
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const contents = readFileSync(join(projectDir, 'config/environment.ts'), 'utf8');
    assert.strictEqual(contents, '// existing consumer config\n', 'existing environment.ts was not overwritten');
    assert.notOk(
      existsSync(join(projectDir, 'config/environment.js')),
      'environment.js was not created alongside existing .ts'
    );
  });

  test('skips copy when consumer already has a `config/environment.js` (no overwrite)', function(assert) {
    mkdirSync(join(projectDir, 'config'), { recursive: true });
    writeFileSync(join(projectDir, 'config/environment.js'), '// existing consumer config\n');

    runPostinstall(projectDir);

    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const contents = readFileSync(join(projectDir, 'config/environment.js'), 'utf8');
    assert.strictEqual(contents, '// existing consumer config\n', 'existing environment.js was not overwritten');
    assert.notOk(
      existsSync(join(projectDir, 'config/environment.ts')),
      'environment.ts was not created alongside existing .js'
    );
  });
});
