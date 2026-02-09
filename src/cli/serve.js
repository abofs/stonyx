import { runStartupHooks, runShutdownHooks } from '../lifecycle.js';

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

  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    await runShutdownHooks(modules);
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const entryModule = await import(`${cwd}/${entryPoint}`);

  if (entryModule.default) {
    new entryModule.default();
  }
}
