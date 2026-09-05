/**
 * SCAFFOLD — abofs/stonyx#108, the `src/modules.ts` catch rewrite.
 *
 * Two facts handed forward from abofs/stonyx#116's review:
 *   1. I2 does not survive end-to-end on the module path — the catch collapses
 *      four distinct failure modes into one fixed claim about a file, and
 *      `CONFIG_NOT_LOADABLE_PREFIX` (exported for exactly this) has zero
 *      non-test importers in `src/`.
 *   2. The rethrow carries no `cause`, so a programmatic supervisor loses the
 *      original error entirely.
 *
 * New coverage lives here rather than in `test/unit/modules-test.ts` so that
 * this PR's diff to that file is exactly the two flips its own comments call
 * for, and nothing else.
 */
import QUnit from 'qunit';

const { module, todo } = QUnit;

module('[Unit] loadModules failure diagnostics', function() {
  todo('F1: a module with NO config is named as such, with both paths it looked for', function(assert) {
    assert.ok(false, 'not implemented');
  });

  todo('F2: a module whose config is present-but-declined reports the decline, not "no config"', function(assert) {
    assert.ok(false, 'not implemented');
  });

  todo('F3: a module whose entry point is missing reports the real ERR_MODULE_NOT_FOUND', function(assert) {
    assert.ok(false, 'not implemented');
  });

  todo('F4: a module whose entry point throws reports that throw', function(assert) {
    assert.ok(false, 'not implemented');
  });

  todo('F5: every branch attaches the original error as `cause`', function(assert) {
    assert.ok(false, 'not implemented');
  });
});
