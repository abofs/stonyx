import QUnit from 'qunit';
import sinon from 'sinon';
import help from '../../../src/cli/help.js';

const { module, test } = QUnit;

module('[Unit] CLI Help', function(hooks) {
  let consoleLogStub;
  let output;

  hooks.beforeEach(function() {
    output = [];
    consoleLogStub = sinon.stub(console, 'log').callsFake((...args) => {
      output.push(args.join(' '));
    });
  });

  hooks.afterEach(function() {
    consoleLogStub.restore();
  });

  test('shows usage line', async function(assert) {
    await help({ args: [], builtInCommands: {}, loadModuleCommands: async () => ({}) });
    const fullOutput = output.join('\n');
    assert.ok(fullOutput.includes('Usage: stonyx'), 'shows usage');
  });

  test('lists built-in commands with descriptions', async function(assert) {
    const builtInCommands = {
      serve: { description: 'Bootstrap and run app' },
      test: { description: 'Run tests' }
    };

    await help({ args: [], builtInCommands, loadModuleCommands: async () => ({}) });
    const fullOutput = output.join('\n');

    assert.ok(fullOutput.includes('serve'), 'lists serve');
    assert.ok(fullOutput.includes('Bootstrap and run app'), 'shows serve description');
    assert.ok(fullOutput.includes('test'), 'lists test');
    assert.ok(fullOutput.includes('Run tests'), 'shows test description');
  });

  test('lists module commands when available', async function(assert) {
    const builtInCommands = {};
    const loadModuleCommands = async () => ({
      'db:migrate': { description: 'Run database migration' }
    });

    await help({ args: [], builtInCommands, loadModuleCommands });
    const fullOutput = output.join('\n');

    assert.ok(fullOutput.includes('Module commands'), 'shows module commands header');
    assert.ok(fullOutput.includes('db:migrate'), 'lists module command');
    assert.ok(fullOutput.includes('Run database migration'), 'shows module command description');
  });

  test('handles no module commands gracefully', async function(assert) {
    const builtInCommands = {};
    const loadModuleCommands = async () => ({});

    await help({ args: [], builtInCommands, loadModuleCommands });
    const fullOutput = output.join('\n');

    assert.notOk(fullOutput.includes('Module commands'), 'does not show module commands header when empty');
  });

  test('handles loadModuleCommands failure gracefully', async function(assert) {
    const builtInCommands = {};
    const loadModuleCommands = async () => { throw new Error('fail'); };

    await help({ args: [], builtInCommands, loadModuleCommands });
    const fullOutput = output.join('\n');

    assert.ok(fullOutput.includes('Usage: stonyx'), 'still shows usage despite error');
  });

  test('shows aliases', async function(assert) {
    await help({ args: [], builtInCommands: {}, loadModuleCommands: async () => ({}) });
    const fullOutput = output.join('\n');

    assert.ok(fullOutput.includes('s=serve'), 'shows serve alias');
    assert.ok(fullOutput.includes('t=test'), 'shows test alias');
    assert.ok(fullOutput.includes('h=help'), 'shows help alias');
  });
});
