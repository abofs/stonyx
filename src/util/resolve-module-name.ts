import { readFileSync } from 'fs';
import { kebabCaseToCamelCase } from '@stonyx/utils/string';

/**
 * Resolve a stonyx standalone module's camelCase name from the consumer's
 * `package.json#name`. Used by the standalone-config transform to wrap a flat
 * config under the module's key when a stonyx module runs its own tests.
 *
 * Recognises:
 *   - `@stonyx/<kebab>`  → `<camel>`
 *   - `stonyx-<kebab>`   → `<camel>` (unscoped fallback)
 *   - Anything else      → `null` (caller should skip the transform)
 *
 * Missing or malformed `package.json` returns `null` silently — matches the
 * fail-safe semantics of the previous `rootPath.includes('stonyx-')` heuristic.
 */
export function resolveModuleName(rootPath: string): string | null {
  let pkg: { name?: unknown };

  try {
    const raw = readFileSync(`${rootPath}/package.json`, 'utf8');
    pkg = JSON.parse(raw);
  } catch {
    return null;
  }

  const name = typeof pkg.name === 'string' ? pkg.name : '';

  if (name.startsWith('@stonyx/')) {
    return kebabCaseToCamelCase(name.slice('@stonyx/'.length));
  }

  if (name.startsWith('stonyx-')) {
    return kebabCaseToCamelCase(name.slice('stonyx-'.length));
  }

  return null;
}
