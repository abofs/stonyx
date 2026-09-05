import { existsSync, realpathSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

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
 * Extensions a consumer plausibly writes a config as, that this loader does not
 * RESOLVE. Their only purpose is to be DETECTED: see `CONFIG_NOT_LOADABLE_PREFIX`.
 *
 * Named for what is actually true of them. `.mjs`, `.cjs` and `.json` are all
 * perfectly readable by Node — `import()` handles every one of them today.
 * Nothing here is unreadable; they are simply not in `LOADABLE_EXTENSIONS`, so
 * this loader never forms a path with them, and a consumer who writes one gets
 * "config present but not loadable" instead of a silent "not found". The old
 * name, UNREADABLE_EXTENSIONS, asserted a property of Node that is false, and
 * invited a future reader to "fix" it by adding them to the resolver.
 */
const UNRESOLVED_EXTENSIONS = [ 'mts', 'cts', 'tsx', 'jsx', 'mjs', 'cjs', 'json' ] as const;

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

/**
 * The first absolute POSIX path named in a Node error message.
 *
 * Both refusal codes name the file they refused, but in different shapes —
 * measured on node v24.13.0:
 *
 *   ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
 *     Stripping types is currently unsupported for files under node_modules,
 *     for "/private/tmp/x/node_modules/dep/thing.ts"
 *   ERR_UNKNOWN_FILE_EXTENSION
 *     Unknown file extension ".ts" for /private/tmp/x/environment.ts
 *
 * The second names a bare extension BEFORE it names the file, which is why
 * this requires a leading `/` rather than matching the first quoted token.
 * Neither error exposes the path as an own property: `Object.keys(error)` is
 * `['code']` for both, so the message is the only source.
 *
 * Deliberately POSIX-only. A Windows path is simply not extracted, and
 * `refusalIsAboutTheConfig` treats "no path extracted" as "cannot tell" and
 * keeps the pre-existing behaviour, so this degrades rather than misfires.
 */
const REFUSED_PATH_PATTERN = /(?:^|[\s"'(])((?:file:\/\/)?\/[^\s"'()]+\.[A-Za-z0-9]+)/;

/** Resolves symlinks so `/tmp/...` and `/private/tmp/...` compare equal. */
function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Did this runtime refuse OUR config file, or something our config imported?
 *
 * `FILE_TYPE_REFUSAL_CODES.has(code)` alone cannot tell. A config that loaded
 * and ran perfectly well, but whose own nested `import()` hit a `.ts` under
 * `node_modules`, throws the SAME code — and was reported as "this Node runtime
 * refused to load your config", naming a file that is fine. That misdirection
 * points the consumer at the one file that is not the problem, and the likeliest
 * instance of it is the exact `.ts`-under-node_modules case this loader's own
 * docs tell people to look for.
 *
 * Returns true when the refusal names our path, or when no path could be
 * extracted at all (unknown message shape — keep re-framing rather than
 * silently losing the loud error that invariant I2 exists for).
 *
 * Exported ONLY so its branches can be reached directly. Driving it through
 * `importConfig` reaches the two path-comparison outcomes and nothing else:
 * the "no path extractable" fallback and the `realPath` catch both survived
 * mutation with the suite green. A predicate inside the guard that makes
 * failures loud does not get to have branches no test can reach.
 */
export function refusalIsAboutTheConfig(message: string, configPath: string): boolean {
  const refused = REFUSED_PATH_PATTERN.exec(message)?.[1];

  if (!refused) return true;

  const refusedPath = refused.startsWith('file://') ? fileURLToPath(refused) : refused;

  return refusedPath === configPath || realPath(refusedPath) === realPath(configPath);
}

export async function importConfig<T = unknown>(basePath: string): Promise<T> {
  const matches = LOADABLE_EXTENSIONS.filter(ext => existsSync(`${basePath}.${ext}`));

  if (matches.length === 0) {
    const declined = UNRESOLVED_EXTENSIONS.filter(ext => existsSync(`${basePath}.${ext}`));

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

    if (code && FILE_TYPE_REFUSAL_CODES.has(code) && refusalIsAboutTheConfig((error as Error).message, path)) {
      // Both files exist AND the `.ts` was refused. This is the one state where
      // the both-present warning printed a few lines above is actively wrong
      // advice: it says "delete the .js", and here the `.js` is the only file
      // this runtime can read. Say so explicitly rather than leaving the
      // consumer to reconcile two messages from the same call.
      //
      // It is also a deliberate behaviour change. `stonyx@0.2.3-beta.95`
      // resolved `${basePath}.js` unconditionally, so this exact state LOADED
      // and booted; measured against that loader, same fixture, plain node:
      // it returned the `.js` default export with no warning. Preferring `.ts`
      // is the point of #105, and the population most likely to hold both
      // files is the one that worked around #105 by renaming to `.js` while
      // the postinstall kept writing the `.ts` stub. So this message has to
      // carry the "this used to work" fact, not just the remedy.
      const sibling = matches.length > 1
        ? ` ${basePath}.js also exists and this runtime CAN read it, but .ts wins the preference order` +
          ` so the .js is never reached. Disregard the "delete the .js" warning above — in THIS state the` +
          ` fix is the opposite one: remove or compile ${basePath}.ts.` +
          ` (stonyx@0.2.3-beta.95 loaded the .js here; preferring .ts is a deliberate change — abofs/stonyx#105.)`
        : '';

      throw new Error(
        `${CONFIG_NOT_LOADABLE_PREFIX} ${path} exists, but this Node runtime refused to load it ` +
        `(${code}): ${(error as Error).message}.${sibling}`,
        { cause: error }
      );
    }

    throw error;
  }
}
