import { runStartupHooks, runShutdownHooks } from '../lifecycle.js';

export function createShutdownHandler(modules) {
  let shuttingDown = false;
  return async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    await runShutdownHooks(modules);
    process.exit(0);
  };
}

export default async function serve({ args }) {
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

  let appInstance;
  if (entryModule.default) {
    appInstance = new entryModule.default();
  }

  // Include the app instance in shutdown if it has a shutdown method
  if (appInstance && typeof appInstance.shutdown === 'function') {
    const originalShutdown = shutdown;
    const appShutdown = createShutdownHandler([...modules, appInstance]);
    process.removeListener('SIGTERM', originalShutdown);
    process.removeListener('SIGINT', originalShutdown);
    process.on('SIGTERM', appShutdown);
    process.on('SIGINT', appShutdown);
  }
}
