import { confirm, prompt } from '@stonyx/utils/prompt';
import { createFile, createDirectory, copyFile, fileExists } from '@stonyx/utils/file';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

interface ModuleOption {
  question: string;
  package: string;
  dirs?: string[];
  files?: Record<string, () => string>;
}

const MODULE_OPTIONS: ModuleOption[] = [
  {
    question: 'Will this project need a REST server?',
    package: '@stonyx/rest-server',
    dirs: ['requests']
  },
  {
    question: 'Will this project need WebSockets?',
    package: '@stonyx/sockets',
    dirs: ['socket-handlers']
  },
  {
    question: 'Will this project need data management?',
    package: '@stonyx/orm',
    dirs: ['models', 'serializers', 'access', 'transforms', 'hooks'],
    files: { 'config/db-schema.js': generateDbSchema }
  },
  {
    question: 'Will this project need scheduled tasks (cron)?',
    package: '@stonyx/cron',
    dirs: ['crons']
  },
  {
    question: 'Will this project need OAuth?',
    package: '@stonyx/oauth'
  },
  {
    question: 'Will this project need pub/sub events?',
    package: '@stonyx/events'
  },
  {
    question: 'Will this project need a Discord bot?',
    package: '@stonyx/discord',
    dirs: ['discord-commands', 'discord-events']
  }
];

function generateDbSchema(): string {
  return `import { Model, hasMany } from '@stonyx/orm';

export default class DBModel extends Model {
  // Define your collections here
  // examples = hasMany('example');
}
`;
}

function generatePackageJson(name: string, selectedModules: ModuleOption[]): string {
  const devDependencies: Record<string, string> = { stonyx: 'latest' };

  for (const mod of selectedModules) {
    devDependencies[mod.package] = 'latest';
  }

  // Sort dependencies alphabetically
  const sorted = Object.fromEntries(
    Object.entries(devDependencies).sort(([a], [b]) => a.localeCompare(b))
  );

  return JSON.stringify({
    name,
    version: '0.1.0',
    type: 'module',
    private: true,
    scripts: {
      start: 'stonyx serve',
      test: 'stonyx test'
    },
    devDependencies: sorted
  }, null, 2) + '\n';
}

function generateAppJs(): string {
  return `import log from 'stonyx/log';

export default class App {
  constructor() {
    if (App.instance) return App.instance;
    App.instance = this;

    this.ready = this.init();
  }

  async init() {
    log.info('Initializing Application');

    // Application setup here

    log.info('Application has been initialized');
  }
}
`;
}

function generateEnvironmentJs(): string {
  return `export default {
}
`;
}

function generateEnvironmentExampleJs(): string {
  return `// Copy this file to environment.js and fill in your values
// All values should use environment variables with ?? fallback defaults

const {
  NODE_ENV,
} = process.env;

const environment = NODE_ENV ?? 'development';

export default {
}
`;
}

function generateGitignore(): string {
  return `node_modules/
.env
db.json
*.log
`;
}

function runPnpmInstall(projectDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['install'], {
      cwd: projectDir,
      stdio: 'inherit'
    });

    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`pnpm install exited with code ${code}`));
    });

    child.on('error', reject);
  });
}

export default async function newCommand({ args }: { args: string[] }): Promise<void> {
  let appName = args[0];

  if (!appName) {
    appName = await prompt('Project name:');
  }

  if (!appName) {
    console.error('Project name is required.');
    process.exit(1);
  }

  const projectDir = path.resolve(process.cwd(), appName);

  if (await fileExists(projectDir)) {
    console.error(`Directory "${appName}" already exists.`);
    process.exit(1);
  }

  console.log(`\nScaffolding new Stonyx project: ${appName}\n`);

  // Prompt for module selection
  const selectedModules: ModuleOption[] = [];

  for (const mod of MODULE_OPTIONS) {
    if (await confirm(mod.question)) {
      selectedModules.push(mod);
    }
  }

  console.log('\nCreating project structure...\n');

  // Create project directory
  await createDirectory(projectDir);

  // Copy .nvmrc from monorepo root
  const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const nvmrcSource = path.join(monorepoRoot, '.nvmrc');

  if (await fileExists(nvmrcSource)) {
    await copyFile(nvmrcSource, path.join(projectDir, '.nvmrc'));
  }

  // Generate core files
  await createFile(path.join(projectDir, 'package.json'), generatePackageJson(appName, selectedModules));
  await createFile(path.join(projectDir, 'app.js'), generateAppJs());
  await createFile(path.join(projectDir, '.gitignore'), generateGitignore());

  // Create config directory and files
  await createFile(path.join(projectDir, 'config', 'environment.js'), generateEnvironmentJs());
  await createFile(path.join(projectDir, 'config', 'environment.example.js'), generateEnvironmentExampleJs());

  // Create module-specific directories and files
  for (const mod of selectedModules) {
    if (mod.dirs) {
      for (const dir of mod.dirs) {
        await createDirectory(path.join(projectDir, dir));
        // Create .gitkeep so empty dirs are tracked
        await createFile(path.join(projectDir, dir, '.gitkeep'), '');
      }
    }

    if (mod.files) {
      for (const [filePath, generator] of Object.entries(mod.files)) {
        await createFile(path.join(projectDir, filePath), generator());
      }
    }
  }

  // Create test structure
  await createDirectory(path.join(projectDir, 'test', 'unit'));
  await createFile(path.join(projectDir, 'test', 'unit', '.gitkeep'), '');
  await createDirectory(path.join(projectDir, 'test', 'integration'));
  await createFile(path.join(projectDir, 'test', 'integration', '.gitkeep'), '');
  await createDirectory(path.join(projectDir, 'test', 'acceptance'));
  await createFile(path.join(projectDir, 'test', 'acceptance', '.gitkeep'), '');

  // Create test config
  await createFile(path.join(projectDir, 'test', 'config', 'environment.js'), `export default {\n  // Test-specific config overrides\n}\n`);

  console.log('Installing dependencies...\n');

  try {
    await runPnpmInstall(projectDir);
  } catch (error) {
    console.error('Failed to install dependencies. Run `pnpm install` manually in the project directory.');
  }

  console.log(`\n✓ Project "${appName}" created successfully!`);
  console.log(`\n  cd ${appName}`);
  console.log(`  stonyx serve\n`);
}
