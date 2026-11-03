import QUnit from 'qunit';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { module, test } = QUnit;

const packageScripts: Record<string, string> = JSON.parse(
  readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
).scripts;

const npmInvocation = /(^|[\s;&|(])(npm|npx|yarn)\s/;

module('[Unit] Package scripts', function() {
  test('prepublishOnly builds and tests through pnpm', function(assert) {
    assert.strictEqual(packageScripts.prepublishOnly, 'pnpm build && pnpm test');
  });

  test('no script invokes npm, npx or yarn', function(assert) {
    const offending = Object.entries(packageScripts)
      .filter(([, command]) => npmInvocation.test(command))
      .map(([name]) => name);
    assert.deepEqual(offending, []);
  });
});
