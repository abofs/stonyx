import QUnit from 'qunit';
import { runStartupHooks, runShutdownHooks, type StoynxModule } from '../../src/lifecycle.js';

const { module, test } = QUnit;

module('[Unit] Lifecycle', function() {
  test('stonyx/lifecycle exports runStartupHooks and runShutdownHooks as functions', async function(assert) {
    const lifecycle = await import('stonyx/lifecycle');
    assert.equal(typeof lifecycle.runStartupHooks, 'function', 'runStartupHooks is a function');
    assert.equal(typeof lifecycle.runShutdownHooks, 'function', 'runShutdownHooks is a function');
  });

  module('runStartupHooks', function() {
    test('calls startup() on modules that define it', async function(assert) {
      const calls: string[] = [];
      const modules: StoynxModule[] = [
        { startup: async () => { calls.push('a'); } },
        { startup: async () => { calls.push('b'); } }
      ];

      await runStartupHooks(modules);
      assert.deepEqual(calls, ['a', 'b']);
    });

    test('skips modules without startup()', async function(assert) {
      const calls: string[] = [];
      const modules: StoynxModule[] = [
        { startup: async () => { calls.push('a'); } },
        {},
        { startup: async () => { calls.push('c'); } }
      ];

      await runStartupHooks(modules);
      assert.deepEqual(calls, ['a', 'c']);
    });

    test('calls startup() in module load order', async function(assert) {
      const calls: number[] = [];
      const modules: StoynxModule[] = [
        { startup: async () => { calls.push(1); } },
        { startup: async () => { calls.push(2); } },
        { startup: async () => { calls.push(3); } }
      ];

      await runStartupHooks(modules);
      assert.deepEqual(calls, [1, 2, 3]);
    });

    test('works with sync startup functions', async function(assert) {
      const calls: string[] = [];
      const modules: StoynxModule[] = [
        { startup: (() => { calls.push('sync'); }) as StoynxModule['startup'] }
      ];

      await runStartupHooks(modules);
      assert.deepEqual(calls, ['sync']);
    });
  });

  module('runShutdownHooks', function() {
    test('calls shutdown() in reverse order', async function(assert) {
      const calls: number[] = [];
      const modules: StoynxModule[] = [
        { shutdown: async () => { calls.push(1); } },
        { shutdown: async () => { calls.push(2); } },
        { shutdown: async () => { calls.push(3); } }
      ];

      await runShutdownHooks(modules);
      assert.deepEqual(calls, [3, 2, 1]);
    });

    test('skips modules without shutdown()', async function(assert) {
      const calls: string[] = [];
      const modules: StoynxModule[] = [
        { shutdown: async () => { calls.push('a'); } },
        {},
        { shutdown: async () => { calls.push('c'); } }
      ];

      await runShutdownHooks(modules);
      assert.deepEqual(calls, ['c', 'a']);
    });

    test('errors in one hook do not prevent others from running', async function(assert) {
      const calls: string[] = [];
      const modules: StoynxModule[] = [
        { shutdown: async () => { calls.push('a'); } },
        { shutdown: async () => { throw new Error('fail'); } },
        { shutdown: async () => { calls.push('c'); } }
      ];

      await runShutdownHooks(modules);
      assert.deepEqual(calls, ['c', 'a'], 'both non-erroring hooks ran');
    });

    test('does not mutate original modules array', async function(assert) {
      const modules: StoynxModule[] = [
        { shutdown: async () => {} },
        { shutdown: async () => {} }
      ];
      const original = [...modules];

      await runShutdownHooks(modules);
      assert.deepEqual(modules, original);
    });
  });
});
