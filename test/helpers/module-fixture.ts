/**
 * Fixture builder for `src/modules.ts` coverage (abofs/stonyx#109).
 *
 * Builds a scratch project root (`package.json`) plus installed packages under
 * `node_modules/<name>/` so `loadModules` can be driven against a real tree.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type Chronicle from '@stonyx/logs';

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
  const dir = join(rootPath, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), typeof pkg === 'string' ? pkg : JSON.stringify({ type: 'module', ...pkg }));

  for (const [ relativePath, content ] of Object.entries(files)) {
    const target = join(dir, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

export function writeRootFile(rootPath: string, relativePath: string, content: string): void {
  const target = join(rootPath, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/** A module entry point whose instance records that `init()` ran. */
export function moduleSource(className: string): string {
  return `export default class ${className} {\n  initialized = false;\n  async init() { this.initialized = true; }\n}\n`;
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
