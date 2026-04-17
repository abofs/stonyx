import { createRequire } from 'module';
import { importConfig } from '../util/import-config.js';
import type { StoynxConfig } from '../modules.js';

const cwd = process.cwd();

const { default: Stonyx } = await import('stonyx');
const config = await importConfig<StoynxConfig>(`${cwd}/config/environment`);

new Stonyx(config, cwd);

// Drain the event loop once qunit finishes. Modules loaded by Stonyx
// (e.g. @stonyx/rest-server) may keep listeners/servers open that would
// otherwise block the process from exiting, causing CI to hit timeouts
// even though all tests passed.
//
// qunit's CLI bin does `delete require.cache[qunitPath]` and re-requires
// qunit before running, so any qunit instance we grab synchronously from
// this --import setup is a DIFFERENT object than the one qunit's CLI
// actually uses. We defer the hook registration with setImmediate so it
// runs AFTER the qunit bin has populated require.cache with its own
// instance; grabbing qunit via CJS require at that point returns the
// instance the tests are running on.
//
// See: https://github.com/abofs/stonyx/issues/55
const require = createRequire(import.meta.url);
setImmediate(() => {
  const qunitPath = require.resolve('qunit', {
    paths: [`${cwd}/node_modules`, cwd]
  });
  const QUnit = require(qunitPath) as { on: (event: string, cb: () => void) => void };
  QUnit.on('runEnd', () => {
    setImmediate(() => process.exit(process.exitCode ?? 0));
  });
});
