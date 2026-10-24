// Install-time contract of `scripts/postinstall.js`, kept as data so the publish-surface
// guard (`test/unit/publish/pack-surface-test.ts`) checks the same names the postinstall
// uses instead of reading them out of its source (abofs/stonyx#123).
//
// Pure data: no imports and no side effects. It ships in the tarball with the postinstall,
// which imports it at install time.

// Package-relative directory the templates are copied from.
export const templateDir = 'config';

// Per consumer type: the template copied out of the package, and the file it becomes
// in the consumer's `config/` directory. A `tsconfig.json` in the consumer root selects `ts`.
export const consumers = {
  ts: { template: 'environment copy.ts', destination: 'environment.ts' },
  js: { template: 'environment copy.js', destination: 'environment.js' },
};
