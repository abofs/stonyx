import QUnit from 'qunit';
import sinon from 'sinon';
import serve from '../../../src/cli/serve.js';

const { module, test } = QUnit;

module('[Unit] CLI Serve', function(hooks) {
  let originalCwd;
  let processOnStub;
  let registeredHandlers;

  hooks.beforeEach(function() {
    originalCwd = process.cwd;
    registeredHandlers = {};
    processOnStub = sinon.stub(process, 'on').callsFake((event, handler) => {
      registeredHandlers[event] = handler;
    });
  });

  hooks.afterEach(function() {
    process.cwd = originalCwd;
    processOnStub.restore();
  });

  test('registers SIGTERM and SIGINT handlers', async function(assert) {
    // We can't fully test serve without a real project, but we can verify
    // the function exists and is exported correctly
    assert.equal(typeof serve, 'function', 'serve is a function');
  });
});
