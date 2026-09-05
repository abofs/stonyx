/**
 * Coverage for the `src/modules.ts` failure diagnostics — abofs/stonyx#108,
 * invariant I2 ("no silent decline") on the module path.
 *
 * Two facts handed forward from abofs/stonyx#116's review, both measured
 * against `src/modules.ts:113-117` before this change:
 *   1. `importConfig`'s "present but not loadable" distinction did NOT survive
 *      end-to-end. One catch spanned four failure modes and replaced all of
 *      them with a fixed claim about a file — a claim that was false about the
 *      file AND about the module in the reproduction #108 was filed over.
 *      `CONFIG_NOT_LOADABLE_PREFIX` was exported for this and had zero
 *      non-test importers in `src/`.
 *   2. The rethrow carried no `cause`, so a programmatic supervisor lost the
 *      original error entirely.
 *
 * AC1 of #108 names the three non-duplicate branches inside that catch as
 * things that "need their own fixtures or they regress silently under the same
 * catch". F1-F4 are those fixtures; F5 is the discrimination assertion, which
 * is the property the four of them exist to buy and which none of them proves
 * on its own.
 *
 * This lives outside `test/unit/modules-test.ts` on purpose: this PR's diff to
 * that file is exactly the two flips its own comments called for, and nothing
 * else. #114's guards there must stay visibly untouched.
 */
import QUnit from 'qunit';
import loadModules from '../../src/modules.js';
import {
  captureConsole,
  createRoot,
  environmentSource,
  installModule,
  moduleSource,
  removeRoot,
  stubChronicle,
} from '../helpers/module-fixture.js';

const { module, test } = QUnit;

const roots: string[] = [];

/** Installs one async module with exactly the files given, and returns the app root. */
function appWith(slug: string, files: Record<string, string>): string {
  const name = `@stonyx/${slug}`;
  const dir = createRoot({ name: `${slug}-app`, devDependencies: { [name]: '1.0.0' }}, 'stonyx-loadfail-fixture-');

  roots.push(dir);
  installModule(dir, name, { main: 'main.js', keywords: [ 'stonyx-module', 'stonyx-async' ]}, {
    'main.js': moduleSource('LoadFailMod'),
    ...files,
  });

  return dir;
}

async function loadFailure(rootPath: string): Promise<Error> {
  const capture = captureConsole();

  try {
    await loadModules({}, rootPath, stubChronicle().asChronicle());
  } catch (error) {
    return error as Error;
  } finally {
    capture.restore();
    // Every branch must reach the caller. A diagnosis on stderr that the
    // thrown error does not carry is the exact defect #116 handed forward.
    if (capture.errors.length) throw new Error(`unexpected console.error: ${String(capture.errors[0])}`);
  }

  throw new Error(`expected ${rootPath} to fail to load`);
}

module('[Unit] loadModules failure diagnostics', function(hooks) {
  hooks.afterEach(function() {
    while (roots.length) removeRoot(roots.pop()!);
  });

  // F1 — config genuinely absent.
  test('F1: a module with NO config is named as such, with both paths it looked for', async function(assert) {
    const rootPath = appWith('f1-noconfig', {});
    const error = await loadFailure(rootPath);

    assert.ok(error.message.includes('@stonyx/f1-noconfig'), 'names the module');
    assert.ok(error.message.includes('and none is installed'), `says the config is absent, got: ${error.message}`);
    assert.ok(
      error.message.includes(`${rootPath}/node_modules/@stonyx/f1-noconfig/config/environment.ts`) &&
      error.message.includes(`${rootPath}/node_modules/@stonyx/f1-noconfig/config/environment.js`),
      'and names BOTH absolute paths it looked for'
    );
    assert.ok(
      (error.cause as Error | undefined)?.message.startsWith('Config not found:'),
      'the loader\'s own error is reachable through `cause`'
    );
    assert.notOk(error.message.includes('must have a config/environment.js file'), 'the old fixed claim is gone');
  });

  // F2 — config present, and this loader declines it. The `.ts`-under-
  // node_modules form of this needs plain node (tsx strips types everywhere)
  // and is covered by modules-test.ts's flipped F-2; the in-process form here
  // is an unresolved extension, which is a real consumer state and reaches the
  // same branch without a subprocess.
  test('F2: a module whose config is present-but-declined reports the decline, not "no config"', async function(assert) {
    const rootPath = appWith('f2-mjs', { 'config/environment.mjs': environmentSource({ port: 1 }) });
    const error = await loadFailure(rootPath);

    assert.ok(error.message.includes('@stonyx/f2-mjs'), 'names the module');
    assert.ok(error.message.includes('declined to load'), `says it was declined, got: ${error.message}`);
    assert.ok(error.message.includes('Config present but not loadable:'), 'and carries the loader\'s own prefix');
    assert.ok(error.message.includes('environment.mjs'), 'naming the file that IS there');
    assert.notOk(error.message.includes('and none is installed'), 'and does not claim the config is absent');
    assert.ok(
      (error.cause as Error | undefined)?.message.startsWith('Config present but not loadable:'),
      'with the loader\'s error as `cause`'
    );
  });

  // F3 — config present, loadable, and it throws. This branch had no coverage
  // at all and produced the same fixed sentence as F1.
  test('F3: a module whose config throws reports that throw, not a missing file', async function(assert) {
    const rootPath = appWith('f3-boom', { 'config/environment.js': 'throw new Error("CONFIG_BOOM");\nexport default {};\n' });
    const error = await loadFailure(rootPath);

    assert.ok(error.message.includes('@stonyx/f3-boom'), 'names the module');
    assert.ok(error.message.includes('failed while loading its default configuration'), `names the step, got: ${error.message}`);
    assert.ok(error.message.includes('CONFIG_BOOM'), 'and reproduces the original message');
    assert.strictEqual((error.cause as Error | undefined)?.message, 'CONFIG_BOOM', 'with the original as `cause`');
    assert.notOk(error.message.includes('and none is installed'), 'and does not claim the config is absent');
  });

  // F4 — entry point evaluates and throws. In the duplicate-core reproduction
  // this is where `Stonyx has not been initialized yet` came from, and the old
  // catch relabelled it as a missing config file for a DIFFERENT module.
  test('F4: a module whose entry point throws reports that throw', async function(assert) {
    const rootPath = appWith('f4-entry', {
      'config/environment.js': environmentSource({ port: 4 }),
      'main.js': 'throw new Error("ENTRY_BOOM");\nexport default class F4 {}\n',
    });
    const error = await loadFailure(rootPath);

    assert.ok(error.message.includes('@stonyx/f4-entry'), 'names the module');
    assert.ok(error.message.includes('failed while importing its entry point'), `names the step, got: ${error.message}`);
    assert.ok(
      error.message.includes(`${rootPath}/node_modules/@stonyx/f4-entry/main.js`),
      'and the absolute path of the file it was importing'
    );
    assert.strictEqual((error.cause as Error | undefined)?.message, 'ENTRY_BOOM', 'with the original as `cause`');
    assert.notOk(error.message.includes('config/environment'), 'and says nothing about a config file');
  });

  // F5 — THE property. F1-F4 each assert their own branch reads correctly; a
  // set of four correct-looking messages that happen to collide is exactly the
  // state #108 was filed over, and no single-branch assertion can see it.
  test('F5: the four branches produce four distinguishable errors, each carrying its cause', async function(assert) {
    const cases: Record<string, Record<string, string>> = {
      'f5-absent': {},
      'f5-declined': { 'config/environment.mjs': environmentSource({ port: 1 }) },
      'f5-throws': { 'config/environment.js': 'throw new Error("F5_CONFIG");\nexport default {};\n' },
      'f5-entry': {
        'config/environment.js': environmentSource({ port: 5 }),
        'main.js': 'throw new Error("F5_ENTRY");\nexport default class F5 {}\n',
      },
    };

    const messages: string[] = [];

    for (const [ slug, files ] of Object.entries(cases)) {
      const error = await loadFailure(appWith(slug, files));

      assert.ok(error.cause instanceof Error, `${slug}: attaches the original error as \`cause\``);
      // Normalise the two things that differ trivially between fixtures, so a
      // collision cannot hide behind the module name or the temp directory.
      messages.push(error.message.replaceAll(slug, 'SLUG').replace(/\/[^\s"']*stonyx-loadfail-fixture-\w+/g, 'ROOT'));
    }

    assert.strictEqual(
      new Set(messages).size,
      4,
      `all four branches are distinguishable after normalisation, got:\n${messages.join('\n---\n')}`
    );
  });
});
