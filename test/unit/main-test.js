
//import log from 'stonyx/log';

const { module, test } = QUnit;

module('[Unit] Main', function() {
  test('importing config too early throws an exception', async function(assert) {
    try {
      await import('stonyx/config');
    } catch (error) {
      console.log(error);
      assert.equal(error.message, 'Stonyx has not been initialized yet');
    }
  });

  test('importing log too early throws an exception', async function(assert) {
    try {
      await import('stonyx/log');
    } catch (error) {
      console.log(error);
      assert.equal(error.message, 'Stonyx has not been initialized yet');
    }
  });
});
