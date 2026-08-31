import { existsSync } from 'fs';
import { resolve } from 'path';
import { EXTENSIONS, dualExtensionWarning } from './extension-resolution.js';

export function resolveEntryPoint(basePath: string): string {
  const matches = EXTENSIONS.filter(ext => existsSync(resolve(`${basePath}.${ext}`)));

  if (matches.length === 0) {
    throw new Error(`Entry point not found: ${basePath}.{ts,js}`);
  }

  if (matches.length > 1) {
    console.warn(dualExtensionWarning(basePath));
  }

  const ext = matches[0];
  return resolve(`${basePath}.${ext}`);
}
