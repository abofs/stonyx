/**
 * Subprocess probe for `coreSeenBy` — abofs/stonyx#108, invariant I1.
 *
 * Exists for one reason: `NODE_PATH` is read ONCE at process bootstrap into
 * `Module.globalPaths`, so a test that sets `process.env.NODE_PATH` in-process
 * changes nothing and its assertion is vacuous. The ancestor filter in
 * `coreSeenBy` can only be observed from a process that was STARTED with a
 * contaminated `NODE_PATH`.
 *
 * That contamination is not hypothetical here: this workspace exports
 * `NODE_PATH` at a different `stonyx` (abofs/stonyx#107), and a refinement in
 * this same cluster recorded a live incident of it resolving the wrong
 * framework version inside a throwaway consumer.
 *
 * Drives `dist/` because that is what a consumer runs.
 *
 * Usage: NODE_PATH=<dir> node test/helpers/core-seen-by-plain-node.mjs <moduleDir>
 * Prints one line: __CORE_SEEN_BY__<json> with { version, root } or null.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distPath = resolve(here, '../../dist/util/duplicate-core.js');

const [ , , moduleDir ] = process.argv;

const { coreSeenBy } = await import(pathToFileURL(distPath).href);

process.stdout.write(`__CORE_SEEN_BY__${JSON.stringify(coreSeenBy(moduleDir) ?? null)}\n`);
