import QUnit from 'qunit';
import testCommand from '../../../src/cli/test.js';

const { module, test } = QUnit;

module('[Unit] CLI Test Command', function() {
  test('test command is a function', async function(assert) {
    assert.equal(typeof testCommand, 'function', 'test command is a function');
  });
});
