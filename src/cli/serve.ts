import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { runStartupHooks, runShutdownHooks, type StoynxModule } from '../lifecycle.js';
import { importConfig } from '../util/import-config.js';
import { resolveEntryPoint } from '../util/resolve-entry-point.js';
import type { StoynxConfig } from '../modules.js';

export function createShutdownHandler(modules: StoynxModule[]): () => Promise<void> {
  let shuttingDown = false;
  return async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    await runShutdownHooks(modules);
    process.exit(0);
  };
}

export function maybeRegisterAppShutdown(
  modules: StoynxModule[],
  appInstance: unknown,
  originalShutdown: () => Promise<void>
): void {
  if (
    appInstance &&
    typeof (appInstance as { shutdown?: unknown }).shutdown === 'function'
  ) {
    const appShutdown = createShutdownHandler([
      ...modules,
      appInstance as { shutdown?: () => Promise<void> }
    ]);
    process.removeListener('SIGTERM', originalShutdown);
    process.removeListener('SIGINT', originalShutdown);
    process.on('SIGTERM', appShutdown);
    process.on('SIGINT', appShutdown);
  }
}

export default async function serve({ args }: { args: string[] }): Promise<void> {
  const cwd = process.cwd();
  const entryFlag = args.indexOf('--entry');
  const entryArg = (entryFlag !== -1 && entryFlag + 1 < args.length) ? args[entryFlag + 1] : null;
  const entryPoint = entryArg !== null ? resolve(cwd, entryArg) : resolveEntryPoint(`${cwd}/app`);

  const config = await importConfig<StoynxConfig>(`${cwd}/config/environment`);
  const { default: Stonyx } = await import('../main.js');

  new Stonyx(config, cwd);
  await Stonyx.ready;

  const { modules } = Stonyx.instance;
  await runStartupHooks(modules);

  const shutdown = createShutdownHandler(modules);

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const entryModule = await import(pathToFileURL(entryPoint).href);

  let appInstance: { shutdown?: () => Promise<void> } | undefined;
  if (entryModule.default) {
    appInstance = new entryModule.default();
  }

  maybeRegisterAppShutdown(modules, appInstance, shutdown);
}
