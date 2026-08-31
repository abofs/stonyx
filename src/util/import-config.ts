import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { EXTENSIONS, dualExtensionWarning } from './extension-resolution.js';

/**
 * Resolve an APP-OWNED config — `<cwd>/config/environment`,
 * `<rootPath>/test/config/environment` — as `{ts,js}`, preferring `.ts`.
 * Mirrors `src/util/resolve-entry-point.ts`, which has resolved app-owned
 * entry points this way since abofs/stonyx#67 — the candidate list and the
 * dual-extension warning are shared through `./extension-resolution.ts` so
 * the two cannot drift.
 *
 * These paths live in the consuming project's own tree, never inside
 * `node_modules`, so they load under the app's own loader and Node's type
 * stripping applies to them.
 *
 * MODULE-OWNED configs are NOT this function's business: see
 * `importModuleConfig` in `./import-module-config.ts`, which resolves `.js`
 * only. Routing `src/modules.ts` here re-ships abofs/stonyx-orm#118 — Node
 * refuses to type-strip inside `node_modules`, so a `.ts` module config
 * crashes every consumer at parse time. See abofs/stonyx#90.
 *
 * The "Config not found:" prefix is load-bearing: `src/main.ts` matches on it
 * to tell an absent optional config from a real import failure.
 */
export async function importConfig<T = unknown>(basePath: string): Promise<T> {
  const matches = EXTENSIONS.filter(ext => existsSync(`${basePath}.${ext}`));

  if (matches.length === 0) {
    throw new Error(`Config not found: ${basePath}.{ts,js}`);
  }

  if (matches.length > 1) {
    console.warn(dualExtensionWarning(basePath));
  }

  const path = `${basePath}.${matches[0]}`;
  const mod = await import(pathToFileURL(path).href);
  return mod.default as T;
}
