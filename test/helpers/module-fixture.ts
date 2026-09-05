/**
 * Fixture builder for `src/modules.ts` coverage (abofs/stonyx#109).
 *
 * Builds a scratch project root (`package.json`) plus installed packages under
 * `node_modules/<name>/` so `loadModules` can be driven against a real tree.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import type Chronicle from '@stonyx/logs';

/**
 * Joins `relativePath` under `base` and REFUSES to escape it.
 *
 * `installModule(root, '../../X')` and `writeRootFile(root, '../X.txt')` both
 * wrote outside the temp root, and `removeRoot` — which only `rm -rf`s the root
 * itself — cleaned neither, leaving debris in `os.tmpdir()` or worse. No caller
 * passes a traversal string today; this closes the hole rather than relying on
 * that staying true. Fixture helpers are the wrong place to trust a caller.
 */
function containedJoin(base: string, relativePath: string): string {
  const root = resolve(base);
  const target = resolve(root, relativePath);

  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`Fixture path escapes its root: "${relativePath}" resolves to ${target}, outside ${root}`);
  }

  return target;
}

export function createRoot(pkg: Record<string, unknown>, prefix = 'stonyx-modules-fixture-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', ...pkg }));
  return dir;
}

/** Writes `node_modules/<name>/package.json` plus any extra files (relative paths). */
export function installModule(
  rootPath: string,
  name: string,
  pkg: Record<string, unknown> | string,
  files: Record<string, string> = {}
): void {
  const dir = containedJoin(join(rootPath, 'node_modules'), name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), typeof pkg === 'string' ? pkg : JSON.stringify({ type: 'module', ...pkg }));

  for (const [ relativePath, content ] of Object.entries(files)) {
    const target = containedJoin(dir, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

export function writeRootFile(rootPath: string, relativePath: string, content: string): void {
  const target = containedJoin(rootPath, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/**
 * A module entry point whose instance records that `init()` ran, and whose
 * CLASS counts how many times it ran across every instance.
 *
 * The counter is what lets T22 tell one instantiation from two. `modulePromises`
 * is keyed by module name, so a module loaded twice resolves the same deferred
 * promise twice and `waitForModule` cannot see the duplicate; the count can.
 * Each fixture is written to its own temp directory, so the ESM registry gives
 * every test a fresh class object and the counters cannot cross tests.
 */
export function moduleSource(className: string): string {
  return `export default class ${className} {\n  static initCount = 0;\n  initialized = false;\n  async init() { this.initialized = true; ${className}.initCount++; }\n}\n`;
}

export function environmentSource(config: Record<string, unknown>): string {
  return `export default ${JSON.stringify(config)};\n`;
}

export function removeRoot(rootPath: string): void {
  rmSync(rootPath, { recursive: true, force: true });
}

export interface StubChronicle {
  defineTypeCalls: unknown[][];
  asChronicle(): Chronicle;
}

/** `loadModules` only ever calls `chronicle.defineType`; record the calls. */
export function stubChronicle(): StubChronicle {
  const defineTypeCalls: unknown[][] = [];
  const stub = { defineTypeCalls, defineType: (...args: unknown[]) => { defineTypeCalls.push(args); } };

  return { defineTypeCalls, asChronicle: () => stub as unknown as Chronicle };
}

export interface ConsoleCapture {
  warnings: string[];
  errors: unknown[];
  restore(): void;
}

export function captureConsole(): ConsoleCapture {
  const warnings: string[] = [];
  const errors: unknown[] = [];
  const originalWarn = console.warn;
  const originalError = console.error;

  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  console.error = (...args: unknown[]) => { errors.push(args[0]); };

  return {
    warnings,
    errors,
    restore() { console.warn = originalWarn; console.error = originalError; },
  };
}

/** Resolves to `'TIMEOUT'` after `ms`; used to detect never-settling promises. */
export function timeout(ms: number): Promise<'TIMEOUT'> {
  return new Promise(resolve => setTimeout(() => resolve('TIMEOUT'), ms).unref());
}
