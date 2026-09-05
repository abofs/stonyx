/**
 * Subprocess entry point for the standalone-transform tests (abofs/stonyx#109).
 *
 * `Stonyx` is a process-global singleton — `main.ts:36` returns instance #1 for
 * every subsequent `new Stonyx(...)`, and `Stonyx.initialized` never resets. So
 * each boot scenario must run in its own process; an in-process rewrite would
 * assert five of six cases against boot #1's config.
 *
 * Usage: node --import tsx test/helpers/boot-stonyx.ts <rootPath> <configJson>
 * Prints one line: __STONYX_BOOT__<json> with { bootError, config }.
 */
import Stonyx from '../../src/main.js';

const [ , , rootPath, configJson ] = process.argv;

const result: { bootError: string | null; config: unknown } = { bootError: null, config: null };

new Stonyx(JSON.parse(configJson!), rootPath!);

try {
  await Stonyx.ready;
} catch (error) {
  result.bootError = error instanceof Error ? error.message : String(error);
}

// `Stonyx.initialized` is set before modules load, so config is readable even
// when the boot failed later in loadModules.
result.config = Stonyx.initialized ? Stonyx.config : null;

process.stdout.write(`__STONYX_BOOT__${JSON.stringify(result)}\n`);
