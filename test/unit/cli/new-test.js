import QUnit from 'qunit';
import newCommand, {
  generateAppTs,
  generateTsConfig,
  generatePackageJson,
  generateGitignore,
  generateEnvironmentTs,
  generateEnvironmentExampleTs,
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

  test('generatePackageJson includes typescript and build script', function (assert) {
    const output = generatePackageJson('test-app', []);
    const pkg = JSON.parse(output);

    assert.ok(pkg.devDependencies.typescript, 'typescript is a devDependency');
    assert.strictEqual(pkg.scripts.build, 'tsc', 'build script runs tsc');
    assert.strictEqual(pkg.scripts.start, 'stonyx serve', 'start script runs stonyx serve');
    assert.strictEqual(pkg.type, 'module', 'type is module');
  });

  test('generateGitignore includes compiled output patterns with test exception', function (assert) {
    const output = generateGitignore();

    assert.ok(output.includes('*.js'), 'ignores compiled .js files');
    assert.ok(output.includes('*.d.ts'), 'ignores declaration files');
    assert.ok(output.includes('*.js.map'), 'ignores source maps');
    assert.ok(output.includes('!test/**/*.js'), 'keeps test JS files');
  });

  test('generateEnvironmentTs produces valid TypeScript', function (assert) {
    const output = generateEnvironmentTs();

    assert.ok(output.includes('export default'), 'has default export');
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
});
