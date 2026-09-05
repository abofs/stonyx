/**
 * Ground truth for the candidate set — abofs/stonyx#108, invariant I1.
 *
 * `coreSeenBy` claims to report "the `stonyx` copy a package installed at
 * `moduleDir` would import". That claim is only checkable against the resolver
 * that actually performs the import, so this asks it: it writes a throwaway ESM
 * probe INTO the module directory — `import.meta.resolve` resolves relative to
 * the importing module's own URL, so the probe has to be physically there — and
 * prints what node returns.
 *
 * A plain node subprocess, not this suite's process, so nothing about the test
 * runner's own resolution is involved.
 *
 * `NODE_PATH` is deliberately NOT stripped by this script: ESM ignores it
 * entirely, and that is one of the properties being pinned. The caller decides.
 *
 * Usage: node test/helpers/esm-resolve-stonyx-plain-node.mjs <moduleDir>
 * Prints one line: __ESM_RESOLVE__<json> with the resolved file URL, or null.
 */
import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [ , , moduleDir ] = process.argv;
const probe = join(moduleDir, '__stonyx-esm-resolve-probe.mjs');

writeFileSync(
  probe,
  'let resolved = null;\n' +
  "try { resolved = import.meta.resolve('stonyx'); } catch { resolved = null; }\n" +
  'process.stdout.write(`__ESM_RESOLVE__${JSON.stringify(resolved)}\\n`);\n'
);

try {
  await import(pathToFileURL(probe).href);
} finally {
  unlinkSync(probe);
}
