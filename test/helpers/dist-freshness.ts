/**
 * Is `dist/` actually built from the `src/` in the working tree?
 *
 * F-5, abofs/stonyx#105. Several tests in this repo assert against `dist/`
 * rather than `src/`, deliberately: the `.ts`-over-`.js` preference and the
 * `node_modules` type-strip refusal are only observable under plain node, and
 * plain node can only run the compiled artifact. Nothing checked that the
 * artifact matched the source.
 *
 * The control, re-measured AT THIS HEAD rather than quoted: apply the M2
 * mutation (`LOADABLE_EXTENSIONS` -> `[ 'js', 'ts' ]`) to
 * `src/util/import-config.ts`, skip the build, run
 * `node --import tsx node_modules/qunit/bin/qunit.js 'test/**\/*-test.ts'`
 * directly.
 *
 *   with `staleDistArtifacts()` stubbed to `[]`  ->  rc=0, 131 pass / 0 fail
 *   with the guard live                          ->  rc=1, 116 pass / 15 fail
 *
 * Fully green without it. The exact mutation `b9d087a` exists to catch went
 * green again, because every plain-node test was reading a stale `dist/`. This
 * guard is what flips it back to red -- that is a control, not an assertion.
 *
 * (The same control read `rc=0, 115 pass / 0 fail` when it was first taken, at
 * `183b34a`. That figure was right at that commit; it is dated, not wrong. The
 * suite has grown by 16 tests since.)
 *
 * `pnpm test` is `pnpm build && qunit`, so CI was never exposed. This bites
 * watch mode and IDE test runners, which invoke the qunit binary directly —
 * and that is where anyone iterating on abofs/stonyx#108 will be working.
 *
 * mtime, not content hashing: `tsconfig.json` sets no `incremental`, so `tsc`
 * rewrites every output on every build and `dist/x.js` is always newer than
 * `src/x.ts` immediately afterwards. Editing a source without rebuilding is
 * therefore detectable, which is the only case that matters.
 */
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const srcDir = join(repoRoot, 'src');
const distDir = join(repoRoot, 'dist');

function sourceFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
      // `.d.ts` files emit no `.js`, so they have no artifact to compare.
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      found.push(full);
    }
  }

  return found;
}

/** Every `src/**\/*.ts` whose `dist/` artifact is missing or older than it. */
export function staleDistArtifacts(): string[] {
  const stale: string[] = [];

  for (const source of sourceFiles(srcDir)) {
    const relativePath = relative(srcDir, source).replace(/\.ts$/, '.js');
    const artifact = join(distDir, relativePath);
    let artifactMtime: number;

    try {
      artifactMtime = statSync(artifact).mtimeMs;
    } catch {
      stale.push(`dist/${relativePath} is MISSING`);
      continue;
    }

    if (statSync(source).mtimeMs > artifactMtime) {
      stale.push(`dist/${relativePath} is OLDER than src/${relative(srcDir, source)}`);
    }
  }

  return stale;
}

/**
 * Throws unless `dist/` is up to date. Called by every helper that drives
 * `dist/` in a subprocess, so a stale artifact fails the test that depends on
 * it — with the reason — instead of silently asserting against old code.
 */
export function assertDistIsFresh(context: string): void {
  const stale = staleDistArtifacts();

  if (stale.length === 0) return;

  throw new Error(
    `${context} runs the compiled artifact, and dist/ is stale — this assertion would have been ` +
    `made against code that is not the code in src/. Run \`pnpm build\` (or \`pnpm test\`, which ` +
    `builds first). Stale: ${stale.join('; ')}`
  );
}
