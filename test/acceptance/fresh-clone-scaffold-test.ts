// Fresh-clone scaffold acceptance harness — abofs/stonyx#89.
//
// This harness MUST land RED. It exists to make the four defects catalogued on
// the #88 epic observable, and each of #90-#93 turns a named assertion green.
// Do not "fix" a failing assertion here; fix it in the story that owns it.
//
// Why a fresh clone: every instance of the #88 trap is INVISIBLE from the
// directory where `stonyx new` ran. The files exist there and are merely
// untracked. The defect only becomes observable after `git clone`.
//
// Gated behind STONYX_ACCEPTANCE=1 because it performs a real `pnpm install`.
import QUnit from 'qunit';

const { module, test } = QUnit;

const ACCEPTANCE = process.env.STONYX_ACCEPTANCE === '1';

module('[Acceptance] Fresh-clone scaffold (abofs/stonyx#89)', function () {
  if (!ACCEPTANCE) {
    test('skipped — set STONYX_ACCEPTANCE=1 to run the fresh-clone harness', function (assert) {
      assert.ok(true, 'harness not run in the default suite (real pnpm install)');
    });

    return;
  }

  test('placeholder — harness body lands in the following commits', function (assert) {
    assert.ok(false, 'not yet implemented');
  });
});
