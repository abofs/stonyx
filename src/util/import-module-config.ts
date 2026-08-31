import { existsSync } from 'fs';
import { pathToFileURL } from 'url';

/**
 * Resolve a MODULE-OWNED config — `node_modules/<mod>/config/environment` — as
 * `.js` ONLY. There is no `.ts` fallback and there must never be one.
 *
 * Node's type-strip loader refuses to process `.ts` files inside
 * `node_modules`, so a `@stonyx/*` module that ships `config/environment.ts`
 * crashes every consumer at parse time. That is abofs/stonyx-orm#118, the P0
 * `4c80c87` was written to prevent, and this function preserves `4c80c87`'s
 * behaviour byte-for-byte — including the exact `Config not found: <base>.js`
 * message, which `test/unit/import-config-test.ts` pins as a regression guard.
 *
 * App-owned configs resolve `{ts,js}` instead: see `importConfig` in
 * `./import-config.ts`. The boundary is OWNERSHIP, not extension — see
 * abofs/stonyx#90 and `docs/conventions/framework-modules.md`.
 */
export async function importModuleConfig<T = unknown>(basePath: string): Promise<T> {
  const path = `${basePath}.js`;

  if (!existsSync(path)) {
    throw new Error(`Config not found: ${path}`);
  }

  const mod = await import(pathToFileURL(path).href);
  return mod.default as T;
}
