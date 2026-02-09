import { readFile } from 'fs/promises';
import path from 'path';

export default async function loadModuleCommands() {
  const cwd = process.cwd();
  const commands = {};

  let projectPackage;

  try {
    const raw = await readFile(path.join(cwd, 'package.json'), 'utf8');
    projectPackage = JSON.parse(raw);
  } catch {
    return commands;
  }

  const allDeps = {
    ...projectPackage.dependencies,
    ...projectPackage.devDependencies
  };

  const stonyxModules = Object.keys(allDeps).filter(name => name.startsWith('@stonyx/'));

  for (const moduleName of stonyxModules) {
    let modulePackage;

    try {
      const raw = await readFile(path.join(cwd, 'node_modules', moduleName, 'package.json'), 'utf8');
      modulePackage = JSON.parse(raw);
    } catch {
      continue;
    }

    const { exports: moduleExports } = modulePackage;

    if (!moduleExports || !moduleExports['./commands']) continue;

    try {
      const commandsModule = await import(path.join(cwd, 'node_modules', moduleName, moduleExports['./commands']));
      const moduleCommands = commandsModule.default;

      for (const [name, command] of Object.entries(moduleCommands)) {
        if (commands[name]) {
          console.warn(`Warning: Command "${name}" from ${moduleName} conflicts with existing command. Skipping.`);
          continue;
        }

        commands[name] = { ...command, module: moduleName };
      }
    } catch {
      continue;
    }
  }

  return commands;
}
