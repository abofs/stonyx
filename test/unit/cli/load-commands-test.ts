import QUnit from 'qunit';
import sinon, { type SinonStub } from 'sinon';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import loadModuleCommands from '../../../src/cli/load-commands.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.resolve(__dirname, '../../sample/tmp-load-commands');

const { module, test } = QUnit;

module('[Unit] CLI Load Commands', function(hooks) {
  let originalCwd: () => string;

  hooks.beforeEach(async function() {
    originalCwd = process.cwd;
    await fsp.mkdir(tmpDir, { recursive: true });
  });

  hooks.afterEach(async function() {
    process.cwd = originalCwd;
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  test('returns empty object when no package.json exists', async function(assert) {
    process.cwd = () => path.join(tmpDir, 'nonexistent');
    const commands = await loadModuleCommands();
    assert.deepEqual(commands, {});
  });

  test('returns empty object when no @stonyx/* dependencies', async function(assert) {
    await fsp.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { express: '1.0.0' }, devDependencies: {} })
    );

    process.cwd = () => tmpDir;
    const commands = await loadModuleCommands();
    assert.deepEqual(commands, {});
  });

  test('gracefully handles modules without ./commands export', async function(assert) {
    await fsp.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { '@stonyx/orm': '1.0.0' }, devDependencies: {} })
    );

    // Create module with no ./commands export
    const modulePath = path.join(tmpDir, 'node_modules', '@stonyx', 'orm');
    await fsp.mkdir(modulePath, { recursive: true });
    await fsp.writeFile(
      path.join(modulePath, 'package.json'),
      JSON.stringify({ name: '@stonyx/orm', exports: { '.': './src/index.js' } })
    );

    process.cwd = () => tmpDir;
    const commands = await loadModuleCommands();
    assert.deepEqual(commands, {});
  });

  test('discovers commands from module with ./commands export', async function(assert) {
    await fsp.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { '@stonyx/test-mod': '1.0.0' }, devDependencies: {} })
    );

    const modulePath = path.join(tmpDir, 'node_modules', '@stonyx', 'test-mod');
    await fsp.mkdir(modulePath, { recursive: true });
    await fsp.writeFile(
      path.join(modulePath, 'package.json'),
      JSON.stringify({ name: '@stonyx/test-mod', exports: { './commands': './commands.js' } })
    );
    await fsp.writeFile(
      path.join(modulePath, 'commands.js'),
      `export default { 'test:run': { description: 'Run test', bootstrap: false, run: async () => {} } };`
    );

    process.cwd = () => tmpDir;
    const commands = await loadModuleCommands();

    assert.ok(commands['test:run'], 'discovered test:run command');
    assert.equal(commands['test:run'].description, 'Run test');
    assert.equal(commands['test:run'].module, '@stonyx/test-mod');
  });

  test('warns on command namespace collision', async function(assert) {
    await fsp.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        dependencies: { '@stonyx/mod-a': '1.0.0', '@stonyx/mod-b': '1.0.0' },
        devDependencies: {}
      })
    );

    for (const mod of ['mod-a', 'mod-b']) {
      const modulePath = path.join(tmpDir, 'node_modules', '@stonyx', mod);
      await fsp.mkdir(modulePath, { recursive: true });
      await fsp.writeFile(
        path.join(modulePath, 'package.json'),
        JSON.stringify({ name: `@stonyx/${mod}`, exports: { './commands': './commands.js' } })
      );
      await fsp.writeFile(
        path.join(modulePath, 'commands.js'),
        `export default { 'shared:cmd': { description: 'From ${mod}', bootstrap: false, run: async () => {} } };`
      );
    }

    const warnStub: SinonStub = sinon.stub(console, 'warn');
    process.cwd = () => tmpDir;

    await loadModuleCommands();

    assert.ok(warnStub.calledOnce, 'warned about collision');
    assert.ok((warnStub.firstCall.args[0] as string).includes('conflicts'), 'warning mentions conflict');
    warnStub.restore();
  });
});
