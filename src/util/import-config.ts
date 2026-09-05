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
 * The absolute POSIX path a Node refusal names, in the two shapes it names it.
 *
 * Both refusal codes name the file they refused, but differently — measured on
 * node v24.13.0 at this head:
 *
 *   ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
 *     Stripping types is currently unsupported for files under node_modules,
 *     for "/private/tmp/x/node_modules/dep/thing.ts"
 *   ERR_UNKNOWN_FILE_EXTENSION
 *     Unknown file extension ".ts" for /private/tmp/x/environment.ts
 *
 * In BOTH shapes the path is the last thing in the message, and both patterns
 * are GREEDY, so each runs to the message tail rather than being bounded by a
 * character class on the path body: the quoted one to the message-final quote,
 * the bare one to the last `.ext` in the message. That is the whole mechanism —
 * measured, an explicit `\s*$` anchor on either one is an equivalent mutant,
 * so it is not there. The previous single pattern instead excluded space, `(`,
 * `)`, `'` and `"` from the body,
 * which meant a config under `~/My Project/` either failed extraction outright
 * or backtracked onto an earlier `.` and yielded a truncated non-path.
 * Measured end-to-end through `dist/` before this change, two consumers one
 * character apart, each with a good `.js` config that nested-imports a `.ts`
 * under `node_modules`:
 *
 *   .../plain/config/environment.js       -> raw ERR_UNSUPPORTED_...
 *                                            naming node_modules/dep/thing.ts
 *   .../My Project/config/environment.js  -> "Config present but not loadable:
 *                                            .../My Project/config/environment.js"
 *
 * The second names a `.js` that loaded and ran perfectly. Anchoring on the
 * tail extracts both, and the quoted form tolerates quotes inside the path
 * because it runs to the message-final quote rather than to the first one.
 *
 * Still POSIX-only, and still not exhaustive — a Windows path is not extracted,
 * and neither is a message with trailing text after the path. That is now SAFE
 * rather than merely degraded: see `refusalIsAboutTheConfig`.
 */
const QUOTED_REFUSED_PATH = /["']((?:file:\/\/)?\/.+)["']/;
const BARE_REFUSED_PATH = /(?:^|\s)((?:file:\/\/)?\/.+\.[A-Za-z0-9]+)/;

/** Resolves symlinks so `/tmp/...` and `/private/tmp/...` compare equal. */
function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * The path a refusal names, or `null` when no path can be extracted from it.
 *
 * `fileURLToPath` is contained for the same reason `realPath` is: this runs
 * INSIDE `importConfig`'s catch handler, so anything it throws replaces the
 * refusal being handled and takes its `cause` with it — the exact loss
 * invariant I2 exists to prevent. Regex-matchable inputs that throw exist and
 * were measured at this head: `file:///a%2Fb.ts` -> `ERR_INVALID_FILE_URL_PATH`,
 * `file:///%.ts` and `file:///a%zz.ts` -> bare `URIError: URI malformed`.
 *
 * Node's own emissions never produce them — `pathToFileURL` percent-encodes a
 * literal `%` and never emits a bare `%2F` for a POSIX filename — but the
 * message is only USUALLY Node's. `refusalIsAboutTheConfig` is exported public
 * API with no input validation, and a `register()` / `--import` loader hook
 * (this suite itself runs under `tsx`) can throw `ERR_UNKNOWN_FILE_EXTENSION`
 * with any message it likes. Driven end-to-end through `dist/` with such a
 * hook before this containment, the consumer got `ERR_INVALID_FILE_URL_PATH:
 * File URL path must not include encoded / characters` with `cause` undefined,
 * and the refusal it was actually handling was gone.
 *
 * An unparseable URL returns `null`, which the predicate reads as "cannot
 * tell" -> `false` -> the original error propagates untouched. Same fail
 * direction as every other unknown in here.
 *
 * Quoted shape first: it is the more specific of the two. Measured at this
 * head the order is an EQUIVALENT mutant — swapping it leaves the suite at
 * 130/0, because neither measured message shape matches both patterns — so the
 * order is a statement of intent, not a load-bearing branch. Recorded here so
 * the next mutation run does not re-chase it.
 */
function refusedPathFrom(message: string): string | null {
  const refused = QUOTED_REFUSED_PATH.exec(message)?.[1] ?? BARE_REFUSED_PATH.exec(message)?.[1];

  if (!refused) return null;

  if (!refused.startsWith('file://')) return refused;

  try {
    return fileURLToPath(refused);
  } catch {
    return null;
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
 * FAIL DIRECTION — this is the property, not an implementation detail.
 * `true` means "re-frame this as a refusal of the config", which is exactly the
 * F-3 misdirection above. So when no path can be extracted this returns
 * `false`, and the caller rethrows Node's own error untouched, `cause` and all.
 * The consumer then reads what actually happened instead of a friendly sentence
 * about the wrong file. This is what makes every future gap in the two patterns
 * harmless: an unparseable message costs the I2 re-framing, not correctness.
 *
 * It previously returned `true` here, on the reasoning that keeping the loud
 * re-frame mattered more than getting the filename right. Measured, that is
 * backwards: the raw error is loud too — `main.ts`'s `NODE_ENV=test` swallow
 * only absorbs `CONFIG_NOT_FOUND_PREFIX`, which a Node refusal never starts
 * with — so failing this way loses nothing and stops naming the wrong file.
 *
 * Exported ONLY so its branches can be reached directly. Driving it through
 * `importConfig` reaches the two path-comparison outcomes and nothing else.
 * A predicate inside the guard that makes failures loud does not get to have
 * branches no test can reach.
 */
export function refusalIsAboutTheConfig(message: string, configPath: string): boolean {
  const refusedPath = refusedPathFrom(message);

  if (refusedPath === null) return false;

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
