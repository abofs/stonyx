import QUnit from 'qunit';
import sinon from 'sinon';
import serve, { createShutdownHandler } from '../../../src/cli/serve.js';

const { module, test } = QUnit;

module('[Unit] CLI Serve', function(hooks) {
  hooks.afterEach(function() {
    sinon.restore();
  });

  test('serve is a function', function(assert) {
    assert.equal(typeof serve, 'function', 'serve is a function');
  });

  module('createShutdownHandler', function() {
    test('returns a callable async function', function(assert) {
      const handler = createShutdownHandler([]);
      assert.equal(typeof handler, 'function');
    });

    test('calls shutdown() on modules that define it', async function(assert) {
      sinon.stub(process, 'exit');

      const calls = [];
      const modules = [
        { shutdown: async () => calls.push('a') },
        { shutdown: async () => calls.push('b') }
      ];

      const handler = createShutdownHandler(modules);
      await handler();

      // runShutdownHooks reverses order
      assert.deepEqual(calls, ['b', 'a']);
    });

    test('is idempotent (second call is a no-op)', async function(assert) {
      sinon.stub(process, 'exit');

      let callCount = 0;
      const modules = [{ shutdown: async () => callCount++ }];

      const handler = createShutdownHandler(modules);
      await handler();
      await handler();

      assert.equal(callCount, 1, 'shutdown hook only called once');
    });

    test('calls process.exit(0) after shutdown hooks complete', async function(assert) {
      const exitStub = sinon.stub(process, 'exit');

      const handler = createShutdownHandler([]);
      await handler();

      assert.ok(exitStub.calledOnce, 'process.exit called once');
      assert.ok(exitStub.calledWith(0), 'process.exit called with 0');
    });
  });
});
