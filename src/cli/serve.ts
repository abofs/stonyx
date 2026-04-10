import { runStartupHooks, runShutdownHooks, type StoynxModule } from '../lifecycle.js';

export function createShutdownHandler(modules: StoynxModule[]): () => Promise<void> {
  let shuttingDown = false;
  return async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    await runShutdownHooks(modules);
    process.exit(0);
  };
}

export default async function serve({ args }: { args: string[] }): Promise<void> {
  const cwd = process.cwd();
  const entryFlag = args.indexOf('--entry');
  const entryPoint = entryFlag !== -1 ? args[entryFlag + 1] : 'app.js';

  const { default: config } = await import(`${cwd}/config/environment.js`);
  const { default: Stonyx } = await import('../main.js');

  new Stonyx(config, cwd);
  await Stonyx.ready;

  const { modules } = Stonyx.instance;
  await runStartupHooks(modules);

  const shutdown = createShutdownHandler(modules);

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const entryModule = await import(`${cwd}/${entryPoint}`);

  if (entryModule.default) {
    new entryModule.default();
  }
}
