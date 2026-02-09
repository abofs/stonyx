export default async function help({ args, builtInCommands, loadModuleCommands } = {}) {
  console.log('\nUsage: stonyx <command> [...args]\n');
  console.log('Commands:\n');

  if (builtInCommands) {
    for (const [name, { description }] of Object.entries(builtInCommands)) {
      console.log(`  ${name.padEnd(20)} ${description}`);
    }
  }

  if (loadModuleCommands) {
    try {
      const moduleCommands = await loadModuleCommands();
      const entries = Object.entries(moduleCommands);

      if (entries.length) {
        console.log('\nModule commands:\n');

        for (const [name, { description }] of entries) {
          console.log(`  ${name.padEnd(20)} ${description}`);
        }
      }
    } catch {
      // Module commands not available (e.g., no project context)
    }
  }

  console.log('\nAliases: s=serve, t=test, h=help\n');
}
