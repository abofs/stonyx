import QUnit from 'qunit';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
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

// ---------------------------------------------------------------------------
// abofs/stonyx#113 — what the scaffold emits as dependency specifiers.
//
// Scaffolded consumers must land on a predictable core version and a coherent
// module set. Every test below is scaffolded as QUnit.todo: it must FAIL while
// the generator still emits "latest", and QUnit hard-fails a todo that starts
// passing, which forces the conversion to `test` when the fix lands.
// ---------------------------------------------------------------------------

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');

async function readOwnVersion(): Promise<string> {
  const raw = await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8');
  return JSON.parse(raw).version as string;
}

QUnit.module('[Unit] CLI New — dependency specifier emission (#113)', function () {
  QUnit.test('emits the core at the generator\'s own exact version, read from package.json', async function (assert) {
    const pkg = JSON.parse(generatePackageJson('test-app', []));
    const own = await readOwnVersion();

    assert.strictEqual(coreSpecifier(pkg), own, 'core specifier equals the generator\'s own version');
  });

  QUnit.test('emits the core as an exact version, never a tag or a range', async function (assert) {
    const pkg = JSON.parse(generatePackageJson('test-app', []));

    assert.ok(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(coreSpecifier(pkg) ?? ''), 'core specifier is an exact semver');
  });

  QUnit.test('declares the core in dependencies, not devDependencies', async function (assert) {
    const pkg = JSON.parse(generatePackageJson('test-app', []));

    assert.ok(pkg.dependencies && pkg.dependencies.stonyx, 'stonyx is in dependencies');
    assert.notOk(pkg.devDependencies.stonyx, 'stonyx is not in devDependencies');
  });

  // Pinned to expected literals, not to `releaseTagFor`. Comparing the emitted
  // specifier against the same function the emitter used made this test unable to
  // fail: replacing `releaseTagFor`'s body with a constant left it green. Three
  // injected release lines mean no constant can satisfy it.
  QUnit.test('emits every MODULE_OPTIONS package on the core\'s release line', async function (assert) {
    const mod = await import('../../../src/cli/new.js') as Record<string, unknown>;
    const options = mod.MODULE_OPTIONS as { package: string }[];
    const modules = options as Parameters<typeof generatePackageJson>[1];

    const expectations: [string, string][] = [
      ['0.2.3-beta.96', 'beta'],
      ['0.2.3-alpha.50', 'alpha'],
      ['0.2.3', 'latest']
    ];

    for (const [coreVersion, expectedTag] of expectations) {
      const pkg = JSON.parse(generatePackageJson('test-app', modules, coreVersion));

      for (const option of options) {
        assert.strictEqual(
          pkg.devDependencies[option.package], expectedTag,
          `core ${coreVersion}: ${option.package} is requested at "${expectedTag}"`
        );
      }
    }

    // And every option really is emitted, so the loop above cannot pass vacuously.
    const emitted = JSON.parse(generatePackageJson('test-app', modules, '0.2.3-beta.96'));
    assert.strictEqual(
      options.filter(o => emitted.devDependencies[o.package]).length, options.length,
      'every MODULE_OPTIONS package appears in devDependencies'
    );
  });

  QUnit.test('emits no dependency at "latest"', async function (assert) {
    const mod = await import('../../../src/cli/new.js') as Record<string, unknown>;
    const options = mod.MODULE_OPTIONS as { package: string }[];
    const pkg = JSON.parse(generatePackageJson('test-app', options as Parameters<typeof generatePackageJson>[1]));
    const specs = Object.entries({ ...(pkg.dependencies ?? {}), ...pkg.devDependencies });

    for (const [name, spec] of specs) {
      assert.notStrictEqual(spec, 'latest', `${name} is not specified as "latest"`);
    }
  });

  QUnit.test('releaseTagFor maps a version to its own release line', async function (assert) {
    const mod = await import('../../../src/cli/new.js') as Record<string, unknown>;
    const releaseTagFor = mod.releaseTagFor as (v: string) => string;

    assert.strictEqual(releaseTagFor('0.2.3-beta.96'), 'beta', 'beta prerelease -> beta tag');
    assert.strictEqual(releaseTagFor('0.2.3-alpha.49'), 'alpha', 'alpha prerelease -> alpha tag');
    assert.strictEqual(releaseTagFor('0.2.2'), 'latest', 'stable version -> latest tag');
  });
});

QUnit.module('[Unit] CLI New — scaffolded manifest on disk (#113)', function (hooks) {
  let tempDir: string;
  let projectDir: string;

  hooks.beforeEach(async function () {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stonyx-new-113-'));
    projectDir = path.join(tempDir, 'sample-app');
    await scaffoldProject(projectDir, 'sample-app', []);
  });

  hooks.afterEach(async function () {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  QUnit.test('the written package.json pins the core at the generator\'s own version', async function (assert) {
    const pkg = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf8'));
    const own = await readOwnVersion();

    assert.strictEqual(coreSpecifier(pkg), own, 'written manifest pins the running core exactly');
  });
});

QUnit.module('[Unit] CLI New — built artifact (#113)', function () {
  // Consumers run dist/cli/new.js, not src/cli/new.ts. `readCoreVersion` resolves
  // this package's root relative to its own file, so the two layouts have to be
  // checked separately: a correct src path can still be wrong once compiled.
  QUnit.test('dist/cli/new.js reads the same core version as the source', async function (assert) {
    const built = await import(path.join(repoRoot, 'dist/cli/new.js')) as Record<string, unknown>;
    const readCoreVersion = built.readCoreVersion as () => string;
    const own = await readOwnVersion();

    assert.strictEqual(readCoreVersion(), own, 'built generator reads its own package.json');

    const generate = built.generatePackageJson as (n: string, m: unknown[]) => string;
    assert.strictEqual(coreSpecifier(JSON.parse(generate('test-app', []))), own, 'built generator emits it');
  });
});

function coreSpecifier(pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }): string | undefined {
  return pkg.dependencies?.stonyx ?? pkg.devDependencies?.stonyx;
}
