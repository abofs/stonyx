import { existsSync } from 'fs';
import { pathToFileURL } from 'url';

/**
 * Extensions `importConfig` will load, in preference order.
 *
 * `.ts` first. `stonyx@0.2.3-beta.62` shipped exactly this list; some release in
 * `(beta.62, beta.82]` reduced it to a hard-coded `.js`, which is the regression
 * abofs/stonyx#105 reports. Three places in this repo disagreed with that
 * reduction and none were changed with it:
 *   - `docs/configuration.md:7,24` documents `.ts` as preferred and describes
 *     this exact algorithm verbatim;
 *   - `scripts/postinstall.js` writes `config/environment.ts` whenever the
 *     consumer has a `tsconfig.json` — the framework wrote the file its own
 *     loader then refused to read, which is how every TypeScript consumer (the
 *     shape `docs/cli.md:29` calls the default) failed to boot at all;
 *   - `src/util/resolve-entry-point.ts` — the sibling resolver, for `app.{ts,js}`
 *     — still prefers `.ts` today.
 */
const LOADABLE_EXTENSIONS = [ 'ts', 'js' ] as const;

/**
 * Extensions a consumer plausibly writes a config as, that this loader will not
 * read. Their only purpose is to be DETECTED: see `CONFIG_NOT_LOADABLE_PREFIX`.
 */
const UNREADABLE_EXTENSIONS = [ 'mts', 'cts', 'tsx', 'jsx', 'mjs', 'cjs', 'json' ] as const;

/**
 * "There is no config here." Callers are allowed to treat this as benign —
 * `src/main.ts` does, for the optional `test/config/environment.*` override.
 *
 * `main.ts` matches on this exact string, so it is exported rather than
 * duplicated: the swallow and the thrower must not be able to drift apart.
 */
export const CONFIG_NOT_FOUND_PREFIX = 'Config not found:';

/**
 * "There is a config here and I declined to load it." Deliberately NOT prefixed
 * with `CONFIG_NOT_FOUND_PREFIX`, because `main.ts`'s `NODE_ENV=test` catch
 * swallows that prefix and must not swallow this.
 *
 * This is invariant I2 of the Sprint 93 install-and-boot cluster — "no silent
 * decline". Before #105 the two states were literally indistinguishable:
 * measured against `stonyx@0.2.3-beta.95`, a consumer with `config/environment.ts`
 * and the same consumer after `mv config/environment.js config/environment.xyz`
 * both produced the byte-identical `Config not found: .../config/environment.js`.
 */
export const CONFIG_NOT_LOADABLE_PREFIX = 'Config present but not loadable:';

/**
 * Node error codes that mean "I can see this file and I refuse to load it",
 * as distinct from "your config threw" or "your config imports something
 * missing". Only these are re-framed; everything else propagates untouched so a
 * genuine syntax error in a consumer's config still reads as one.
 *
 * `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` is the load-bearing member:
 * Node refuses to type-strip anything under `node_modules`, so a `@stonyx/*`
 * module that ships `config/environment.ts` crashes every consumer. That rule
 * is unchanged by this fix and is why `docs/conventions/framework-modules.md`
 * still requires modules to ship `.js` — but the failure is now named.
 */
const FILE_TYPE_REFUSAL_CODES = new Set([
  'ERR_UNKNOWN_FILE_EXTENSION',
  'ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING',
]);

export async function importConfig<T = unknown>(basePath: string): Promise<T> {
  const matches = LOADABLE_EXTENSIONS.filter(ext => existsSync(`${basePath}.${ext}`));

  if (matches.length === 0) {
    const declined = UNREADABLE_EXTENSIONS.filter(ext => existsSync(`${basePath}.${ext}`));

    if (declined.length > 0) {
      throw new Error(
        `${CONFIG_NOT_LOADABLE_PREFIX} ${basePath}.${declined.join(` and ${basePath}.`)} ` +
        `exists, but Stonyx loads ${basePath}.ts or ${basePath}.js only. ` +
        `Rename or compile it — this is not a missing config.`
      );
    }

    throw new Error(`${CONFIG_NOT_FOUND_PREFIX} ${basePath}.{ts,js}`);
  }

  if (matches.length > 1) {
    console.warn(
      `Warning: both ${basePath}.ts and ${basePath}.js exist. Using .ts — delete the .js to silence this warning (it is likely a stale compiled artifact or postinstall stub).`
    );
  }

  const path = `${basePath}.${matches[0]}`;

  try {
    const mod = await import(pathToFileURL(path).href);

    return mod.default as T;
  } catch (error) {
    const code = (error as { code?: string } | undefined)?.code;

    if (code && FILE_TYPE_REFUSAL_CODES.has(code)) {
      const sibling = matches.length > 1
        ? ` A ${basePath}.js also exists; .ts wins by design, so this is not resolved by leaving the .js in place.`
        : '';

      throw new Error(
        `${CONFIG_NOT_LOADABLE_PREFIX} ${path} exists, but this Node runtime refused to load it ` +
        `(${code}): ${(error as Error).message}${sibling}`,
        { cause: error }
      );
    }

    throw error;
  }
}
