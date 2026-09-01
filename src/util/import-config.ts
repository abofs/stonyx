import { existsSync } from 'fs';
import { pathToFileURL } from 'url';

export async function importConfig<T = unknown>(basePath: string): Promise<T> {
  const path = `${basePath}.js`;
  if (!existsSync(path)) {
    throw new Error(`Config not found: ${path}`);
  }
  const mod = await import(pathToFileURL(path).href);
  return mod.default as T;
}
