import { confirm, prompt } from '@stonyx/utils/prompt';
import { createFile, createDirectory, copyFile, fileExists } from '@stonyx/utils/file';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

interface ModuleOption {
  question: string;
  package: string;
  dirs?: string[];
  files?: Record<string, () => string>;
}

export const MODULE_OPTIONS: ModuleOption[] = [
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
    files: { 'config/db-schema.ts': generateDbSchema }
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

export function generateDbSchema(): string {
  return `import { Model, hasMany, type HasMany } from '@stonyx/orm';

export default class DBModel extends Model {
  // Define your collections here
  // examples: HasMany = hasMany('example');
}
`;
}

/**
 * The npm dist-tag that points at a package's stable release line. Only ever
 * used as a *release line* selector for `@stonyx/*` modules (see
 * `releaseTagFor`) -- never as the specifier for the core, which is always
 * pinned exactly.
 */
const STABLE_DIST_TAG = 'latest';

/** Absolute path to this package's own root, from both `src/` and `dist/`. */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The version of the `stonyx` package running this generator, read from its own
 * `package.json` at call time.
 *
 * Read rather than hardcoded on purpose: a literal would be correct on the day
 * it was written and silently stale on every day after (abofs/stonyx#113).
 */
export function readCoreVersion(): string {
  const raw = readFileSync(path.join(packageRoot, 'package.json'), 'utf8');
  const version = (JSON.parse(raw) as { version?: unknown }).version;

  if (typeof version !== 'string' || !version) {
    throw new Error(`Could not read the stonyx version from ${path.join(packageRoot, 'package.json')}`);
  }

  return version;
}

/**
 * The npm dist-tag naming the release line a version belongs to:
 * `0.2.3-beta.96` -> `beta`, `0.2.3-alpha.4` -> `alpha`, `0.2.2` -> `latest`.
 *
 * Every scaffolded `@stonyx/*` module is requested on the same line as the core
 * that scaffolded it, so the generated project cannot mix a prerelease core with
 * modules from the stable line (or the reverse).
 *
 * Bound: this assumes a prerelease identifier is also a published dist-tag name.
 * True for `beta` and `alpha`, which are the only two lines the fleet publishes.
 * A core released as e.g. `0.2.3-rc.1` with no `rc` dist-tag would scaffold an
 * unresolvable module specifier -- loudly, at install, not silently.
 */
export function releaseTagFor(version: string): string {
  const prerelease = /^\d+\.\d+\.\d+-([0-9A-Za-z-]+)(?:\.|$)/.exec(version);

  return prerelease ? prerelease[1] : STABLE_DIST_TAG;
}

export function generatePackageJson(
  name: string,
  selectedModules: ModuleOption[],
  coreVersion: string = readCoreVersion()
): string {
  // The framework is a runtime dependency of the application, pinned exactly to
  // the core that generated the project.
  const dependencies: Record<string, string> = { stonyx: coreVersion };

  const devDependencies: Record<string, string> = {
    qunit: '^2.24.1',
    tsx: '^4.21.0',
    typescript: '^5.8.3'
  };

  // Modules are discovered from devDependencies (see docs/modules.md), and are
  // requested on the core's own release line rather than at `latest`.
  const moduleTag = releaseTagFor(coreVersion);

  for (const mod of selectedModules) {
    devDependencies[mod.package] = moduleTag;
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
      build: 'tsc',
      serve: 'stonyx serve',
      start: 'stonyx serve',
      test: "NODE_ENV=test node --import tsx/esm --import ./test/setup.ts node_modules/qunit/bin/qunit.js 'test/**/*-test.ts'"
    },
    dependencies,
    devDependencies: sorted
  }, null, 2) + '\n';
}

export function generateAppTs(): string {
  return `import log from 'stonyx/log';

export default class App {
  static instance: App;
  ready: Promise<void>;

  constructor() {
    if (App.instance) return App.instance;
    App.instance = this;

    this.ready = this.init();
  }

  async init(): Promise<void> {
    log.info('Initializing Application');

    // Application setup here

    log.info('Application has been initialized');
  }
}
`;
}

export function generateEnvironmentTs(): string {
  return `import type { StoynxConfig } from 'stonyx';

const config: StoynxConfig = {
};

export default config;
`;
}

export function generateTestEnvironmentTs(): string {
  return `import type { StoynxConfig } from 'stonyx';

// Test-specific config overrides
const config: Partial<StoynxConfig> = {
};

export default config;
`;
}

export function generateSetupTs(): string {
  return `// Test setup: bootstrap Stonyx with the consumer config before qunit runs.
// Sprint 44 pattern — loaded via \`node --import ./test/setup.ts\`.
import { pathToFileURL } from 'url';

const cwd = process.cwd();

const { default: Stonyx } = await import('stonyx');
const { default: config } = await import(pathToFileURL(\`\${cwd}/config/environment.ts\`).href);

new Stonyx(config, cwd);

await Stonyx.ready;
`;
}

export function generateZzExitTestTs(): string {
  return `// Force-exit hook for qunit runs.
//
// Stonyx modules may keep listeners/servers open that would otherwise
// block the process from exiting after tests complete, causing CI to
// hit timeouts even though all tests passed.
//
// Named \`zz-\` so alphabetical test-file order places it last, after
// all real test files have registered with QUnit.
import QUnit from 'qunit';

QUnit.on('runEnd', () => {
  setImmediate(() => process.exit(process.exitCode ?? 0));
});
`;
}

export function generateEnvironmentExampleTs(): string {
  return `// Copy this file to environment.ts and fill in your values
// All values should use environment variables with ?? fallback defaults

const {
  NODE_ENV,
} = process.env;

const environment: string = NODE_ENV ?? 'development';

export default {
}
`;
}

export function generateGitignore(): string {
  return `node_modules/
.env
db.json
*.log

# Compiled TypeScript output (tsc compiles .ts to .js in-place)
*.js
*.d.ts
*.js.map
`;
}

export function generateTsConfig(): string {
  return JSON.stringify({
    compilerOptions: {
      strict: true,
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      outDir: '.',
      rootDir: '.',
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true
    },
    include: ['**/*.ts'],
    exclude: ['node_modules', 'test']
  }, null, 2) + '\n';
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

/**
 * Write every scaffolded file to disk given a resolved project directory,
 * app name, and pre-selected module options. Factored out of `newCommand`
 * so tests can exercise the file-writing path without interactive prompts.
 */
export async function scaffoldProject(
  projectDir: string,
  appName: string,
  selectedModules: ModuleOption[]
): Promise<void> {
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
  await createFile(path.join(projectDir, 'app.ts'), generateAppTs());
  await createFile(path.join(projectDir, 'tsconfig.json'), generateTsConfig());
  await createFile(path.join(projectDir, '.gitignore'), generateGitignore());

  // Create config directory and files
  await createFile(path.join(projectDir, 'config', 'environment.ts'), generateEnvironmentTs());
  await createFile(path.join(projectDir, 'config', 'environment.example.ts'), generateEnvironmentExampleTs());

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

  // Create test config (TS)
  await createFile(path.join(projectDir, 'test', 'config', 'environment.ts'), generateTestEnvironmentTs());

  // Create Sprint 44 test harness files (setup bootstraps Stonyx, zz-exit-test drains event loop)
  await createFile(path.join(projectDir, 'test', 'setup.ts'), generateSetupTs());
  await createFile(path.join(projectDir, 'test', 'zz-exit-test.ts'), generateZzExitTestTs());
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

  await scaffoldProject(projectDir, appName, selectedModules);

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
