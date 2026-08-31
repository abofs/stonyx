/**
 * Shared constants for APP-OWNED `{ts,js}` resolution.
 *
 * Two resolvers pick an extension for a file in the consuming project's own
 * tree — `resolveEntryPoint` (`./resolve-entry-point.ts`, since
 * abofs/stonyx#67) and `importConfig` (`./import-config.ts`, since
 * abofs/stonyx#90). They must agree on the candidate list, on the preference
 * order, and on the wording of the dual-extension warning.
 *
 * They previously agreed by copy. Each string was pinned by its own suite, so
 * editing one file left BOTH suites green while the two messages diverged —
 * which is why this lives here and not at the top of either consumer
 * (`docs/conventions/index.md` § Universal Rules: constants shared across
 * files go in a dedicated constants file).
 *
 * MODULE-OWNED configs are not in scope: `./import-module-config.ts` resolves
 * `.js` only, forever, and deliberately shares nothing with this file.
 */

/** Candidate extensions in preference order — `.ts` wins over `.js`. */
export const EXTENSIONS = ['ts', 'js'] as const;

/** The warning both app-owned resolvers emit when a `.ts`/`.js` pair exists. */
export function dualExtensionWarning(basePath: string): string {
  return `Warning: both ${basePath}.ts and ${basePath}.js exist. Using .ts — delete the .js to silence this warning (it is likely a stale compiled artifact or postinstall stub).`;
}
