import QUnit from 'qunit';
import sinon, { type SinonStub } from 'sinon';
import serve, { createShutdownHandler, maybeRegisterAppShutdown } from '../../../src/cli/serve.js';
import type { StoynxModule } from '../../../src/lifecycle.js';

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

      const calls: string[] = [];
      const modules: StoynxModule[] = [
        { shutdown: async () => { calls.push('a'); } },
        { shutdown: async () => { calls.push('b'); } }
      ];

      const handler = createShutdownHandler(modules);
      await handler();

      // runShutdownHooks reverses order
      assert.deepEqual(calls, ['b', 'a']);
    });

    test('is idempotent (second call is a no-op)', async function(assert) {
      sinon.stub(process, 'exit');

      let callCount = 0;
      const modules: StoynxModule[] = [{ shutdown: async () => { callCount++; } }];

      const handler = createShutdownHandler(modules);
      await handler();
      await handler();

      assert.equal(callCount, 1, 'shutdown hook only called once');
    });

    test('calls process.exit(0) after shutdown hooks complete', async function(assert) {
      const exitStub: SinonStub = sinon.stub(process, 'exit');

      const handler = createShutdownHandler([]);
      await handler();

      assert.ok(exitStub.calledOnce, 'process.exit called once');
      assert.ok(exitStub.calledWith(0), 'process.exit called with 0');
    });
  });

  module('serve() handler registration', function(hooks) {
    let onStub: SinonStub;
    let removeListenerStub: SinonStub;
    const originalShutdown = async (): Promise<void> => {};

    hooks.beforeEach(function() {
      onStub = sinon.stub(process, 'on');
      removeListenerStub = sinon.stub(process, 'removeListener');
    });

    test('re-registers handlers when entry module has shutdown()', function(assert) {
      const modules: StoynxModule[] = [];
      const appInstance = { shutdown: async (): Promise<void> => {} };

      maybeRegisterAppShutdown(modules, appInstance, originalShutdown);

      assert.ok(
        removeListenerStub.calledWith('SIGTERM', originalShutdown),
        'removed original SIGTERM listener'
      );
      assert.ok(
        removeListenerStub.calledWith('SIGINT', originalShutdown),
        'removed original SIGINT listener'
      );
      assert.equal(removeListenerStub.callCount, 2, 'removeListener called exactly twice');

      const sigtermCalls = onStub.getCalls().filter(c => c.args[0] === 'SIGTERM');
      const sigintCalls = onStub.getCalls().filter(c => c.args[0] === 'SIGINT');
      assert.equal(sigtermCalls.length, 1, 'new SIGTERM handler registered');
      assert.equal(sigintCalls.length, 1, 'new SIGINT handler registered');
      assert.notStrictEqual(
        sigtermCalls[0].args[1],
        originalShutdown,
        'new SIGTERM handler is not the original shutdown closure'
      );
    });

    test('does NOT re-register when entry module lacks shutdown()', function(assert) {
      const modules: StoynxModule[] = [];
      const appInstance = {};

      maybeRegisterAppShutdown(modules, appInstance, originalShutdown);

      assert.equal(removeListenerStub.callCount, 0, 'removeListener was not called');
      assert.equal(onStub.callCount, 0, 'process.on was not called');
    });

    test('does NOT re-register when entry module has no default export', function(assert) {
      const modules: StoynxModule[] = [];
      const appInstance = undefined;

      maybeRegisterAppShutdown(modules, appInstance, originalShutdown);

      assert.equal(removeListenerStub.callCount, 0, 'removeListener was not called');
      assert.equal(onStub.callCount, 0, 'process.on was not called');
    });
  });
});
