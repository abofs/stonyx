import Qunit from 'qunit';
import { mergeObject } from '@stonyx/base/utils/object';

const { module, test } = Qunit;

module('[Unit] Utils', function() {
  test('mergeObject works as expected', async function(assert) {
    assert.deepEqual(
      mergeObject({ a: 1, b: 2 }, { c: 3 }),
      { a: 1, b: 2, c: 3 },
      'New properties are added'
    );

    assert.deepEqual(
      mergeObject({ a: 1, b: 2, c: 3 }, { c: 4 }),
      { a: 1, b: 2, c: 4 },
      'Old properties are overwritten'
    );

    assert.deepEqual(
      mergeObject({ a: 1, b: 2, c: 3 }, { a: 7, c: 23, d: { a: 1, b: 2, c: 3 } }),
      { a: 7, b: 2, c: 23, d: { a: 1, b: 2, c: 3 } },
      'Objects are merged recursively'
    );

    try {
      mergeObject([], {});
    } catch {
      assert.ok(true, 'Array inputs throws error');
    }
  });
});
