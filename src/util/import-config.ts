import { existsSync } from 'fs';
import { pathToFileURL } from 'url';

const EXTENSIONS = ['ts', 'js'] as const;

export async function importConfig<T = unknown>(basePath: string): Promise<T> {
  const matches = EXTENSIONS.filter(ext => existsSync(`${basePath}.${ext}`));

  if (matches.length === 0) {
    throw new Error(`Config not found: ${basePath}.{ts,js}`);
  }

  if (matches.length > 1) {
    console.warn(
      `Warning: both ${basePath}.ts and ${basePath}.js exist. Using .ts — delete the .js to silence this warning (it is likely a stale compiled artifact or postinstall stub).`
    );
  }

  const ext = matches[0];
  const mod = await import(pathToFileURL(`${basePath}.${ext}`).href);
  return mod.default as T;
}
