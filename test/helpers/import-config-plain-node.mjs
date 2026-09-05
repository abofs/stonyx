/**
 * Subprocess entry point that drives `dist/util/import-config.js` under PLAIN
 * node — no `tsx`, no loader hooks. See abofs/stonyx#105.
 *
 * The suite itself runs under `node --import tsx`, and tsx makes every `.ts`
 * file importable from everywhere, INCLUDING under `node_modules`. That is not
 * how a consumer runs `stonyx serve`, and it hides the exact case #105's
 * invariant I2 exists for: Node refuses to type-strip inside `node_modules`, so
 * a module shipping `config/environment.ts` is present-and-declined. Asserted
 * from inside the tsx process, that case is green and proves nothing.
 *
 * This runs the SHIPPED artifact (`dist/`, which `pnpm test` rebuilds first)
 * under the SHIPPED runtime, which is the only place the refusal is observable.
 *
 * It is ALSO the only place the `.ts`-over-`.js` preference is observable.
 * Measured at this head: with both `environment.ts` and `environment.js`
 * present, tsx resolves an `import()` of `...environment.js` to the `.ts` file,
 * so an in-process test returns `{source:'ts'}` no matter which extension the
 * loader picked. A mutation swapping LOADABLE_EXTENSIONS to `['js','ts']`
 * survived the whole suite green until this case was moved out here.
 *
 * Usage: node test/helpers/import-config-plain-node.mjs <basePath>
 * Prints one line: __IMPORT_CONFIG__<json> with
 * { ok, value, message, causeCode, warnings }.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distPath = resolve(here, '../../dist/util/import-config.js');

const [ , , basePath ] = process.argv;

const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };

const result = { ok: false, value: null, message: null, causeCode: null, warnings };

try {
  const { importConfig } = await import(pathToFileURL(distPath).href);
  result.value = await importConfig(basePath);
  result.ok = true;
} catch (error) {
  result.message = error instanceof Error ? error.message : String(error);
  result.causeCode = error?.cause?.code ?? error?.code ?? null;
}

console.warn = originalWarn;

process.stdout.write(`__IMPORT_CONFIG__${JSON.stringify(result)}\n`);
