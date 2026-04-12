import { readFile } from 'fs/promises';
import path from 'path';

export interface CommandDefinition {
  description: string;
  run: (ctx: { args: string[]; cwd?: string }) => Promise<void>;
  bootstrap?: boolean;
  module?: string;
}

export default async function loadModuleCommands(): Promise<Record<string, CommandDefinition>> {
  const cwd = process.cwd();
  const commands: Record<string, CommandDefinition> = {};

  let projectPackage: Record<string, Record<string, string>>;

  try {
    const raw = await readFile(path.join(cwd, 'package.json'), 'utf8');
    projectPackage = JSON.parse(raw);
  } catch {
    return commands;
  }

  const allDeps: Record<string, string> = {
    ...projectPackage.dependencies,
    ...projectPackage.devDependencies
  };

  const stonyxModules = Object.keys(allDeps).filter(name => name.startsWith('@stonyx/'));

  for (const moduleName of stonyxModules) {
    let modulePackage: Record<string, unknown>;

    try {
      const raw = await readFile(path.join(cwd, 'node_modules', moduleName, 'package.json'), 'utf8');
      modulePackage = JSON.parse(raw);
    } catch {
      continue;
    }

    const moduleExports = modulePackage.exports as Record<string, string> | undefined;

    if (!moduleExports || !moduleExports['./commands']) continue;

    try {
      const commandsModule = await import(path.join(cwd, 'node_modules', moduleName, moduleExports['./commands']));
      if (!commandsModule.default || typeof commandsModule.default !== 'object') continue;
      const moduleCommands = commandsModule.default as Record<string, CommandDefinition>;

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
