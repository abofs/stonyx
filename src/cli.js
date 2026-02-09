#!/usr/bin/env node

import serve from './cli/serve.js';
import test from './cli/test.js';
import help from './cli/help.js';
import loadModuleCommands from './cli/load-commands.js';

const aliases = { s: 'serve', t: 'test', h: 'help' };

const builtInCommands = {
  serve: { description: 'Bootstrap Stonyx and run the app', run: serve },
  test: { description: 'Bootstrap Stonyx in test mode and run tests', run: test },
  help: { description: 'Show available commands', run: help }
};

const args = process.argv.slice(2);
const commandName = aliases[args[0]] || args[0];
const commandArgs = args.slice(1);

async function main() {
  if (!commandName || commandName === 'help') {
    await help({ args: commandArgs, builtInCommands, loadModuleCommands });
    return;
  }

  const builtIn = builtInCommands[commandName];

  if (builtIn) {
    await builtIn.run({ args: commandArgs });
    return;
  }

  // Search module commands
  const moduleCommands = await loadModuleCommands();
  const moduleCommand = moduleCommands[commandName];

  if (moduleCommand) {
    const cwd = process.cwd();

    if (moduleCommand.bootstrap) {
      const { default: config } = await import(`${cwd}/config/environment.js`);
      const { default: Stonyx } = await import('./main.js');
      new Stonyx(config, cwd);
      await Stonyx.ready;
    }

    await moduleCommand.run({ args: commandArgs, cwd });
    return;
  }

  console.error(`Unknown command: ${args[0]}\n`);
  await help({ args: [], builtInCommands, loadModuleCommands });
  process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
