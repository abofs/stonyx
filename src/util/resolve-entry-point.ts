import { existsSync } from 'fs';
import { resolve } from 'path';

const EXTENSIONS = ['ts', 'js'] as const;

export function resolveEntryPoint(basePath: string): string {
  const matches = EXTENSIONS.filter(ext => existsSync(resolve(`${basePath}.${ext}`)));

  if (matches.length === 0) {
    throw new Error(`Entry point not found: ${basePath}.{ts,js}`);
  }

  if (matches.length > 1) {
    console.warn(
      `Warning: both ${basePath}.ts and ${basePath}.js exist. Using .ts — delete the .js to silence this warning (it is likely a stale compiled artifact or postinstall stub).`
    );
  }

  const ext = matches[0];
  return resolve(`${basePath}.${ext}`);
}
