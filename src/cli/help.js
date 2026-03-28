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

  console.log('\nAliases: s=serve, t=test, n=new, h=help\n');

  console.log('Project conventions:\n');
  console.log('  Entry point:       app.js');
  console.log('  Config:            config/environment.js');
  console.log('  DB schema:         config/db-schema.js');
  console.log('  Models:            models/');
  console.log('  Serializers:       serializers/');
  console.log('  Access control:    access/');
  console.log('  Transforms:        transforms/');
  console.log('  Hooks:             hooks/');
  console.log('  REST requests:     requests/');
  console.log('  Cron jobs:         crons/');
  console.log('  Tests:             test/{unit,integration,acceptance}/');
  console.log('');
  console.log('  Logging:           import log from \'stonyx/log\' (never console.log)');
  console.log('  Utilities:         import from \'@stonyx/utils/*\' (never raw fs)');
  console.log('  Lint config:       import from \'@abofs/code-conventions\'');
  console.log('  Package manager:   pnpm');
  console.log('');
}
