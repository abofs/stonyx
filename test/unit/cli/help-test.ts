import QUnit from 'qunit';
import sinon, { type SinonStub } from 'sinon';
import help from '../../../src/cli/help.js';
import type { CommandDefinition } from '../../../src/cli/load-commands.js';

const { module, test } = QUnit;

module('[Unit] CLI Help', function(hooks) {
  let consoleLogStub: SinonStub;
  let output: string[];

  hooks.beforeEach(function() {
    output = [];
    consoleLogStub = sinon.stub(console, 'log').callsFake((...args: unknown[]) => {
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
    const builtInCommands: Record<string, CommandDefinition> = {
      serve: { description: 'Bootstrap and run app', run: async () => {} },
      test: { description: 'Run tests', run: async () => {} }
    };

    await help({ args: [], builtInCommands, loadModuleCommands: async () => ({}) });
    const fullOutput = output.join('\n');

    assert.ok(fullOutput.includes('serve'), 'lists serve');
    assert.ok(fullOutput.includes('Bootstrap and run app'), 'shows serve description');
    assert.ok(fullOutput.includes('test'), 'lists test');
    assert.ok(fullOutput.includes('Run tests'), 'shows test description');
  });

  test('lists module commands when available', async function(assert) {
    const builtInCommands: Record<string, CommandDefinition> = {};
    const loadModuleCommands = async (): Promise<Record<string, CommandDefinition>> => ({
      'db:migrate': { description: 'Run database migration', bootstrap: false, run: async () => {} }
    });

    await help({ args: [], builtInCommands, loadModuleCommands });
    const fullOutput = output.join('\n');

    assert.ok(fullOutput.includes('Module commands'), 'shows module commands header');
    assert.ok(fullOutput.includes('db:migrate'), 'lists module command');
    assert.ok(fullOutput.includes('Run database migration'), 'shows module command description');
  });

  test('handles no module commands gracefully', async function(assert) {
    const builtInCommands: Record<string, CommandDefinition> = {};
    const loadModuleCommands = async (): Promise<Record<string, CommandDefinition>> => ({});

    await help({ args: [], builtInCommands, loadModuleCommands });
    const fullOutput = output.join('\n');

    assert.notOk(fullOutput.includes('Module commands'), 'does not show module commands header when empty');
  });

  test('handles loadModuleCommands failure gracefully', async function(assert) {
    const builtInCommands: Record<string, CommandDefinition> = {};
    const loadModuleCommands = async (): Promise<Record<string, CommandDefinition>> => { throw new Error('fail'); };

    await help({ args: [], builtInCommands, loadModuleCommands });
    const fullOutput = output.join('\n');

    assert.ok(fullOutput.includes('Usage: stonyx'), 'still shows usage despite error');
  });

  // F-1. `help` is production output: it printed `config/environment.js` and
  // `app.js` as THE project conventions while `importConfig` prefers
  // `config/environment.ts` (src/util/import-config.ts LOADABLE_EXTENSIONS) and
  // `resolveEntryPoint` prefers `app.ts` (src/util/resolve-entry-point.ts
  // EXTENSIONS) — and `stonyx new` scaffolds both as `.ts`
  // (src/cli/new.ts:257,262). Nothing asserted on this block, which is why the
  // AC5 doc sweep could not have caught it: that sweep was path-scoped to
  // `docs/ README.md`.
  test('conventions block states the extension order the resolvers actually use', async function(assert) {
    await help({ args: [], builtInCommands: {}, loadModuleCommands: async () => ({}) });
    const fullOutput = output.join('\n');

    assert.ok(
      /Entry point:\s+app\.ts \(or app\.js\)/.test(fullOutput),
      'entry point is advertised as .ts-preferred, matching resolveEntryPoint'
    );
    assert.ok(
      /Config:\s+config\/environment\.ts \(or \.js\)/.test(fullOutput),
      'config is advertised as .ts-preferred, matching importConfig'
    );
  });

  // The specific regression: the line must not advertise `.js` as the only
  // config extension. Stated as its own assertion so a future edit that drops
  // the `(or .js)` half still reds the test above but this one stays honest
  // about what the P0 was.
  test('conventions block never advertises config/environment.js alone', async function(assert) {
    await help({ args: [], builtInCommands: {}, loadModuleCommands: async () => ({}) });
    const fullOutput = output.join('\n');

    assert.notOk(
      /Config:\s+config\/environment\.js\s*$/m.test(fullOutput),
      'does not print `Config: config/environment.js` as the whole convention'
    );
  });

  test('shows aliases', async function(assert) {
    await help({ args: [], builtInCommands: {}, loadModuleCommands: async () => ({}) });
    const fullOutput = output.join('\n');

    assert.ok(fullOutput.includes('s=serve'), 'shows serve alias');
    assert.ok(fullOutput.includes('t=test'), 'shows test alias');
    assert.ok(fullOutput.includes('h=help'), 'shows help alias');
  });
});
