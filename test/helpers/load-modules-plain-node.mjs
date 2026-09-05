/**
 * Subprocess entry point that drives `dist/modules.js` under PLAIN node — no
 * `tsx`, no loader hooks. Sibling of `import-config-plain-node.mjs`, and it
 * exists for the same reason. See abofs/stonyx#105.
 *
 * The suite runs under `node --import tsx`, which makes `.ts` importable from
 * everywhere INCLUDING under `node_modules`. The whole point of the case this
 * drives — a `@stonyx/*` module shipping `config/environment.ts` — is that
 * Node REFUSES that file under `node_modules`. Asserted from inside the tsx
 * process the module loads fine and the assertion proves nothing.
 *
 * It reports BOTH channels separately. That WAS the fact under test — the
 * loader's precise error reached stderr via a bare `console.error` while the
 * thrown error was a generic relabel. abofs/stonyx#108 moved the diagnosis
 * into the thrown error (with `cause`) and removed the side-channel log, so
 * the stderr array is now expected to be EMPTY. Both channels are still
 * reported because "nothing was logged behind the caller" is itself an
 * assertion, and it can only be made by a probe that would have seen it.
 *
 * Usage: node test/helpers/load-modules-plain-node.mjs <rootPath>
 * Prints one line: __LOAD_MODULES__<json> with { thrown, stderr }.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distPath = resolve(here, '../../dist/modules.js');

const [ , , rootPath ] = process.argv;

const stderr = [];
const originalError = console.error;
console.error = (...args) => {
  stderr.push(args.map(a => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(' '));
};

const result = { thrown: null, stderr };

try {
  const { default: loadModules } = await import(pathToFileURL(distPath).href);
  // `configureLog` is the only Chronicle surface `loadModules` touches.
  await loadModules({}, rootPath, { defineType() {} });
} catch (error) {
  result.thrown = {
    message: error instanceof Error ? error.message : String(error),
    // `undefined` would vanish through JSON; distinguish "absent" explicitly.
    hasCause: error instanceof Error && error.cause !== undefined,
    causeMessage: error?.cause?.message ?? null,
  };
}

console.error = originalError;

process.stdout.write(`__LOAD_MODULES__${JSON.stringify(result)}\n`);
