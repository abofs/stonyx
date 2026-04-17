import QUnit from 'qunit';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import newCommand, {
  scaffoldProject,
  generateAppTs,
  generateTsConfig,
  generatePackageJson,
  generateGitignore,
  generateEnvironmentTs,
  generateEnvironmentExampleTs,
  generateTestEnvironmentTs,
  generateSetupTs,
  generateZzExitTestTs,
  generateDbSchema
} from '../../../src/cli/new.js';

const { module, test } = QUnit;

module('[Unit] CLI New — TypeScript Blueprints', function () {
  test('newCommand is a function', function (assert) {
    assert.equal(typeof newCommand, 'function');
  });

  test('generateAppTs produces TypeScript with proper type annotations', function (assert) {
    const output = generateAppTs();

    assert.ok(output.includes('static instance: App'), 'has static instance property');
    assert.ok(output.includes('ready: Promise<void>'), 'has typed ready property');
    assert.ok(output.includes('async init(): Promise<void>'), 'has typed init method');
    assert.ok(output.includes("import log from 'stonyx/log'"), 'has stonyx log import');
    assert.notOk(output.includes('any'), 'no any types');
  });

  test('generateTsConfig produces strict TypeScript config matching ecosystem', function (assert) {
    const output = generateTsConfig();
    const config = JSON.parse(output);

    assert.strictEqual(config.compilerOptions.strict, true, 'strict mode enabled');
    assert.strictEqual(config.compilerOptions.module, 'NodeNext', 'module is NodeNext');
    assert.strictEqual(config.compilerOptions.moduleResolution, 'NodeNext', 'moduleResolution is NodeNext');
    assert.strictEqual(config.compilerOptions.target, 'ES2022', 'target is ES2022');
    assert.strictEqual(config.compilerOptions.outDir, '.', 'outDir is . (compile in-place)');
    assert.strictEqual(config.compilerOptions.rootDir, '.', 'rootDir is . (compile in-place)');
    assert.ok(config.exclude.includes('node_modules'), 'excludes node_modules');
    assert.ok(config.exclude.includes('test'), 'excludes test');
  });

  test('generatePackageJson includes TS toolchain and Sprint 44 test script', function (assert) {
    const output = generatePackageJson('test-app', []);
    const pkg = JSON.parse(output);

    assert.ok(pkg.devDependencies.typescript, 'typescript is a devDependency');
    assert.ok(pkg.devDependencies.tsx, 'tsx is a devDependency');
    assert.ok(pkg.devDependencies.qunit, 'qunit is a devDependency');
    assert.strictEqual(pkg.scripts.build, 'tsc', 'build script runs tsc');
    assert.strictEqual(pkg.scripts.serve, 'stonyx serve', 'serve script runs stonyx serve');
    assert.strictEqual(pkg.scripts.start, 'stonyx serve', 'start script runs stonyx serve');
    assert.ok(pkg.scripts.test.includes('--import tsx/esm'), 'test script uses tsx/esm loader');
    assert.ok(pkg.scripts.test.includes('./test/setup.ts'), 'test script imports setup.ts');
    assert.ok(pkg.scripts.test.includes("'test/**/*-test.ts'"), 'test script targets .ts test files');
    assert.ok(pkg.scripts.test.includes('NODE_ENV=test'), 'test script sets NODE_ENV=test');
    assert.strictEqual(pkg.type, 'module', 'type is module');
  });

  test('generateGitignore includes compiled output patterns', function (assert) {
    const output = generateGitignore();

    assert.ok(output.includes('*.js'), 'ignores compiled .js files');
    assert.ok(output.includes('*.d.ts'), 'ignores declaration files');
    assert.ok(output.includes('*.js.map'), 'ignores source maps');
    assert.notOk(output.includes('!test/**/*.js'), 'no stale .js test exception (TS-native)');
  });

  test('generateEnvironmentTs produces valid TypeScript with type annotation', function (assert) {
    const output = generateEnvironmentTs();

    assert.ok(output.includes('export default'), 'has default export');
    assert.ok(output.includes('StoynxConfig'), 'references StoynxConfig type');
    assert.ok(output.includes("from 'stonyx'"), 'imports type from stonyx');
  });

  test('generateTestEnvironmentTs produces typed partial config override', function (assert) {
    const output = generateTestEnvironmentTs();

    assert.ok(output.includes('export default'), 'has default export');
    assert.ok(output.includes('Partial<StoynxConfig>'), 'uses Partial<StoynxConfig>');
  });

  test('generateSetupTs bootstraps Stonyx and awaits ready', function (assert) {
    const output = generateSetupTs();

    assert.ok(output.includes("await import('stonyx')"), 'imports stonyx');
    assert.ok(output.includes('new Stonyx(config, cwd)'), 'constructs Stonyx instance');
    assert.ok(output.includes('await Stonyx.ready'), 'awaits Stonyx.ready');
    assert.ok(output.includes('config/environment.ts'), 'loads config/environment.ts');
  });

  test('generateZzExitTestTs registers runEnd force-exit hook', function (assert) {
    const output = generateZzExitTestTs();

    assert.ok(output.includes("import QUnit from 'qunit'"), 'imports QUnit');
    assert.ok(output.includes("QUnit.on('runEnd'"), 'registers runEnd hook');
    assert.ok(output.includes('process.exit'), 'calls process.exit');
  });

  test('generateEnvironmentExampleTs references .ts extension in instructions', function (assert) {
    const output = generateEnvironmentExampleTs();

    assert.ok(output.includes('environment.ts'), 'references .ts extension');
    assert.ok(output.includes('const environment: string'), 'has typed variable');
  });

  test('generateDbSchema uses TypeScript type import', function (assert) {
    const output = generateDbSchema();

    assert.ok(output.includes('type HasMany'), 'imports HasMany type');
    assert.ok(output.includes('HasMany = hasMany'), 'uses type annotation in comment example');
  });

  test('generatePackageJson includes selected module dependencies sorted alphabetically', function (assert) {
    const modules = [
      { question: '', package: '@stonyx/sockets' },
      { question: '', package: '@stonyx/orm' }
    ];
    const output = generatePackageJson('test-app', modules as Parameters<typeof generatePackageJson>[1]);
    const pkg = JSON.parse(output);
    const depNames = Object.keys(pkg.devDependencies);

    assert.ok(pkg.devDependencies['@stonyx/sockets'], 'includes sockets');
    assert.ok(pkg.devDependencies['@stonyx/orm'], 'includes orm');
    assert.deepEqual(depNames, [...depNames].sort(), 'dependencies sorted alphabetically');
  });

});

module('[Unit] CLI New — Scaffold Output (temp directory)', function (hooks) {
  let tempDir: string;
  let projectDir: string;

  hooks.beforeEach(async function () {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stonyx-new-test-'));
    projectDir = path.join(tempDir, 'sample-app');
    // Scaffold with zero selected modules so the output is the minimal TS-native baseline.
    await scaffoldProject(projectDir, 'sample-app', []);
  });

  hooks.afterEach(async function () {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('produces no .js files anywhere in the scaffolded tree', async function (assert) {
    const jsFiles = await collectFiles(projectDir, (name) => name.endsWith('.js'));
    assert.deepEqual(jsFiles, [], 'no .js files scaffolded into new project');
  });

  test('scaffolds tsconfig.json with Stonyx-recommended settings (no paths)', async function (assert) {
    const tsconfigPath = path.join(projectDir, 'tsconfig.json');
    const raw = await fs.readFile(tsconfigPath, 'utf8');
    const parsed = JSON.parse(raw);

    assert.strictEqual(parsed.compilerOptions.strict, true, 'strict mode');
    assert.strictEqual(parsed.compilerOptions.module, 'NodeNext', 'module NodeNext');
    assert.strictEqual(parsed.compilerOptions.target, 'ES2022', 'target ES2022');
    assert.notOk(parsed.compilerOptions.paths, 'no paths (per Sprint 45 finding)');
  });

  test('scaffolds package.json with tsx + typescript + Sprint 44 test script', async function (assert) {
    const pkgPath = path.join(projectDir, 'package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));

    assert.ok(pkg.devDependencies.tsx, 'tsx in devDependencies');
    assert.ok(pkg.devDependencies.typescript, 'typescript in devDependencies');
    assert.ok(pkg.devDependencies.qunit, 'qunit in devDependencies');
    assert.ok(pkg.scripts.test.includes('--import tsx/esm'), 'test uses tsx/esm');
    assert.ok(pkg.scripts.test.includes('./test/setup.ts'), 'test imports setup.ts');
    assert.strictEqual(pkg.scripts.serve, 'stonyx serve', 'serve script present');
  });

  test('scaffolds test/setup.ts and test/zz-exit-test.ts (Sprint 44 pattern)', async function (assert) {
    const setupPath = path.join(projectDir, 'test', 'setup.ts');
    const zzPath = path.join(projectDir, 'test', 'zz-exit-test.ts');

    const setupContent = await fs.readFile(setupPath, 'utf8');
    const zzContent = await fs.readFile(zzPath, 'utf8');

    assert.ok(setupContent.includes('await Stonyx.ready'), 'setup.ts awaits Stonyx.ready');
    assert.ok(zzContent.includes("QUnit.on('runEnd'"), 'zz-exit-test.ts registers runEnd hook');
  });

  test('scaffolds config/environment.ts with TypeScript type annotations', async function (assert) {
    const envPath = path.join(projectDir, 'config', 'environment.ts');
    const envContent = await fs.readFile(envPath, 'utf8');

    assert.ok(envContent.includes('StoynxConfig'), 'references StoynxConfig type');
    assert.notOk(envContent.match(/^export default \{\}\s*$/m), 'not a bare export default {}');
  });

  test('scaffolds test/config/environment.ts (not .js)', async function (assert) {
    const tsExists = await fileExists(path.join(projectDir, 'test', 'config', 'environment.ts'));
    const jsExists = await fileExists(path.join(projectDir, 'test', 'config', 'environment.js'));

    assert.ok(tsExists, 'test/config/environment.ts exists');
    assert.notOk(jsExists, 'test/config/environment.js was NOT scaffolded');
  });
});

async function collectFiles(dir: string, predicate: (name: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      const nested = await collectFiles(full, predicate);
      out.push(...nested);
    } else if (entry.isFile() && predicate(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
