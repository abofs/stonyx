import QUnit from 'qunit';
import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, '../../../src/cli.js');

function run(args, cwd) {
  return new Promise((resolve) => {
    execFile('node', [cliPath, ...args], { cwd }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr, code: error?.code ?? 0 });
    });
  });
}

const { module, test } = QUnit;

module('[Unit] CLI Entry Point', function() {
  test('no command shows help output', async function(assert) {
    const result = await run([], __dirname);
    assert.ok(result.stdout.includes('Usage: stonyx'), 'shows usage');
    assert.ok(result.stdout.includes('serve'), 'lists serve command');
    assert.ok(result.stdout.includes('test'), 'lists test command');
    assert.ok(result.stdout.includes('help'), 'lists help command');
  });

  test('help alias "h" shows help output', async function(assert) {
    const result = await run(['h'], __dirname);
    assert.ok(result.stdout.includes('Usage: stonyx'), 'shows usage');
  });

  test('unknown command shows error and help', async function(assert) {
    const result = await run(['nonexistent'], __dirname);
    assert.ok(result.stderr.includes('Unknown command: nonexistent'), 'shows error for unknown command');
  });

  test('help command lists aliases', async function(assert) {
    const result = await run(['help'], __dirname);
    assert.ok(result.stdout.includes('s=serve'), 'shows serve alias');
    assert.ok(result.stdout.includes('t=test'), 'shows test alias');
    assert.ok(result.stdout.includes('h=help'), 'shows help alias');
  });
});
