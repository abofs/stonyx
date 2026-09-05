/**
 * Coverage for `src/util/import-config.ts`. See abofs/stonyx#105.
 *
 * Two properties are under test and they are not the same property:
 *
 *   AC1 — the loader accepts `.ts` and prefers it. This is a RESTORATION:
 *         `stonyx@0.2.3-beta.62` resolved `{ts,js}`, some release in
 *         `(beta.62, beta.82]` cut it to a hard-coded `.js`, and
 *         `docs/configuration.md:24` never stopped documenting the original
 *         algorithm. `scripts/postinstall.js` never stopped WRITING `.ts` for
 *         `tsconfig.json` consumers either — the framework wrote the file its
 *         own loader refused, so every TypeScript consumer failed to boot.
 *
 *   AC2 — invariant I2, "no silent decline": a config file present at the base
 *         path and not loaded is a LOUD failure, never the absent outcome.
 *         Restoring `.ts` without this leaves the defect class alive, because
 *         `main.ts` swallows `Config not found:` for the optional test override.
 *         Measured against `beta.95`: a `.ts` config and a `.xyz` config
 *         produced the byte-identical `Config not found: .../environment.js`.
 *
 *   AC4 — the over-correction guard. A genuinely ABSENT test override must stay
 *         non-fatal. AC2 must not be implemented by making every unread file
 *         fatal.
 *
 * THE FLIP. The `.ts`-only case below previously read
 *   test('throws "Config not found: *.js" when only .ts exists', ...)
 *     assert.notOk(message.includes('.ts'), '<message claiming .ts was unsupported>');
 * That test pinned the regression as the contract. It is INVERTED here, in
 * #105's own diff, not deleted — a deletion leaves a green suite that proves
 * nothing, and the guard silently stops guarding.
 *
 * Runtime note: this suite runs under `node --import tsx`, which makes `.ts`
 * importable from anywhere, including `node_modules`. That is NOT how a
 * consumer runs `stonyx serve`. The cases whose outcome depends on the runtime
 * (T7) therefore run `dist/` under plain `node` in a subprocess via
 * `test/helpers/import-config-plain-node.mjs`; asserting them in-process would
 * be green for the wrong reason.
 */
import QUnit from 'qunit';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  importConfig,
  CONFIG_NOT_FOUND_PREFIX,
  CONFIG_NOT_LOADABLE_PREFIX,
} from '../../src/util/import-config.js';

const { module, test } = QUnit;

const execFileAsync = promisify(execFile);
const helpersDir = resolve(dirname(fileURLToPath(import.meta.url)), '../helpers');
const plainNodeScript = join(helpersDir, 'import-config-plain-node.mjs');
const bootScript = join(helpersDir, 'boot-stonyx.ts');

/**
 * Hard upper bound on one subprocess. Matches `standalone-transform-test.ts`
 * and exists for the same reason: `execFile` has no default timeout and this
 * repo sets no `QUnit.config.testTimeout`, so an unbounded child that never
 * exits hangs the whole run with no TAP output at all.
 */
const SUBPROCESS_TIMEOUT_MS = 20_000;

let dir: string;
let basePath: string;

interface PlainNodeResult {
  ok: boolean;
  value: unknown;
  message: string | null;
  causeCode: string | null;
  warnings: string[];
}

/** Drives `dist/util/import-config.js` under plain node — no tsx. */
async function importConfigInPlainNode(base: string): Promise<PlainNodeResult> {
  const { stdout, stderr } = await execFileAsync(
    'node',
    [ plainNodeScript, base ],
    { timeout: SUBPROCESS_TIMEOUT_MS, killSignal: 'SIGKILL' }
  );

  const marker = stdout.split('__IMPORT_CONFIG__')[1];
  if (!marker) throw new Error(`plain-node run produced no result. stdout: ${stdout}\nstderr: ${stderr}`);

  return JSON.parse(marker) as PlainNodeResult;
}

interface BootResult {
  bootError: string | null;
  config: Record<string, unknown> | null;
}

/** One real `new Stonyx(...)` + `await Stonyx.ready` in its own process. */
async function boot(rootPath: string, config: Record<string, unknown>): Promise<BootResult> {
  const { stdout, stderr } = await execFileAsync(
    'node',
    [ '--import', 'tsx', bootScript, rootPath, JSON.stringify(config) ],
    { env: { ...process.env, NODE_ENV: 'test' }, timeout: SUBPROCESS_TIMEOUT_MS, killSignal: 'SIGKILL' }
  );

  const marker = stdout.split('__STONYX_BOOT__')[1];
  if (!marker) throw new Error(`boot produced no result. stdout: ${stdout}\nstderr: ${stderr}`);

  return JSON.parse(marker) as BootResult;
}

module('[Unit] importConfig', function(hooks) {
  hooks.beforeEach(function() {
    // Unique subdir per test so module import cache can't collide across tests
    dir = mkdtempSync(join(tmpdir(), 'stonyx-import-config-'));
    basePath = join(dir, 'environment');
  });

  hooks.afterEach(function() {
    rmSync(dir, { recursive: true, force: true });
  });

  // T1 — unchanged by #105. Dies if `.js` is dropped from LOADABLE_EXTENSIONS.
  test('returns default export when only .js exists', async function(assert) {
    writeFileSync(`${basePath}.js`, `export default { source: 'js', port: 4000 };\n`);

    const config = await importConfig<{ source: string; port: number }>(basePath);

    assert.equal(config.source, 'js');
    assert.equal(config.port, 4000);
  });

  // T2 — AC1-a. THE FLIP. This test previously asserted the opposite:
  //   'throws "Config not found: *.js" when only .ts exists'
  //   assert.notOk(message.includes('.ts'), '<message claiming .ts was unsupported>');
  // Inverted in #105's own diff. Dies if `.ts` is removed from
  // LOADABLE_EXTENSIONS, or if the hard-coded `${basePath}.js` returns.
  test('returns default export when only .ts exists (#105 — inverts the beta.82 contract)', async function(assert) {
    writeFileSync(`${basePath}.ts`, `const config: { source: string } = { source: 'ts' };\nexport default config;\n`);

    const config = await importConfig<{ source: string }>(basePath);

    assert.equal(config.source, 'ts', '.ts config LOADS — it is a supported extension');
  });

  // T3 — AC1-b. `.ts` wins when both exist, and the ambiguity is warned about.
  // `docs/configuration.md:24` documents exactly this.
  //
  // Runs under PLAIN node, and this is not optional. Written in-process it
  // MEASURABLY does not guard: tsx resolves an `import()` of `environment.js`
  // to the sibling `environment.ts`, so it returns `{source:'ts'}` whichever
  // extension the loader chose. A mutation swapping LOADABLE_EXTENSIONS to
  // `['js','ts']` was run against the in-process form and the ENTIRE suite
  // stayed green — 108 pass / 0 fail. In this form the same mutation reds.
  test('prefers .ts over .js when both exist, and warns (plain node — tsx cannot see this)', async function(assert) {
    writeFileSync(`${basePath}.ts`, `const config: { source: string } = { source: 'ts' };\nexport default config;\n`);
    writeFileSync(`${basePath}.js`, `export default { source: 'js' };\n`);

    const result = await importConfigInPlainNode(basePath);

    assert.ok(result.ok, 'loads');
    assert.deepEqual(result.value, { source: 'ts' }, '.ts wins when both are present');
    assert.equal(result.warnings.length, 1, 'exactly one warning');
    assert.ok(result.warnings[0]?.includes('Using .ts'), 'the warning names which file won');
  });

  // T4 — AC1-c / AC2-d (absent direction). Genuinely absent stays absent, and
  // the message names BOTH extensions so it cannot be read as ".js only".
  test('throws "Config not found:" naming {ts,js} when neither exists', async function(assert) {
    try {
      await importConfig(basePath);
      assert.ok(false, 'should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      assert.ok(message.startsWith(CONFIG_NOT_FOUND_PREFIX), 'error starts with "Config not found:"');
      assert.ok(message.endsWith('.{ts,js}'), 'message names both supported extensions');
    }
  });

  // T5 — AC2-a. Invariant I2. A config the consumer wrote at an extension this
  // loader will not read is NOT "not found". Dies if the UNREADABLE_EXTENSIONS
  // branch is removed (it then falls through to `Config not found:`).
  test('a config at an unsupported extension is "present but not loadable", NOT "not found"', async function(assert) {
    writeFileSync(`${basePath}.mjs`, `export default { source: 'mjs' };\n`);

    try {
      await importConfig(basePath);
      assert.ok(false, 'should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      assert.ok(message.startsWith(CONFIG_NOT_LOADABLE_PREFIX), 'uses the present-but-not-loadable prefix');
      assert.notOk(message.startsWith(CONFIG_NOT_FOUND_PREFIX), 'is NOT reported as absent');
      assert.ok(message.includes(`${basePath}.mjs`), 'names the file the consumer actually wrote');
    }
  });

  // T6 — AC2-d (declined direction, both ways round). The pair T4/T6 is the
  // whole point: before #105 these two states produced byte-identical output.
  test('absent and declined produce DIFFERENT messages for the same base path', async function(assert) {
    const absent = await importConfig(basePath).catch(err => (err as Error).message);

    writeFileSync(`${basePath}.json`, `{"source":"json"}\n`);
    const declined = await importConfig(basePath).catch(err => (err as Error).message);

    assert.notEqual(declined, absent, 'the two states are distinguishable');
    assert.ok((absent as string).startsWith(CONFIG_NOT_FOUND_PREFIX), 'absent reads as absent');
    assert.ok((declined as string).startsWith(CONFIG_NOT_LOADABLE_PREFIX), 'declined reads as declined');
  });

  // T7 — AC2-b. Node refuses to type-strip under `node_modules`, so a
  // `@stonyx/*` module shipping `config/environment.ts` is present-and-declined.
  // This is the case `docs/conventions/framework-modules.md` exists to prevent,
  // and it MUST NOT report as absent — a module whose config silently vanishes
  // boots with framework defaults and no signal.
  //
  // Runs `dist/` under plain node: under this suite's own `tsx` the refusal
  // does not happen at all, so an in-process assertion here would be green
  // regardless of the code under test.
  test('a .ts config Node refuses to type-strip (under node_modules) is loud, not absent', async function(assert) {
    const modConfigDir = join(dir, 'node_modules', 'fake-stonyx-module', 'config');
    mkdirSync(modConfigDir, { recursive: true });
    writeFileSync(
      join(modConfigDir, 'environment.ts'),
      `const config: { source: string } = { source: 'ts-in-node-modules' };\nexport default config;\n`
    );

    const result = await importConfigInPlainNode(join(modConfigDir, 'environment'));

    assert.notOk(result.ok, 'plain node does not load it');
    assert.ok(result.message?.startsWith(CONFIG_NOT_LOADABLE_PREFIX), 'reported as present-but-not-loadable');
    assert.notOk(result.message?.startsWith(CONFIG_NOT_FOUND_PREFIX), 'NOT reported as absent');
    assert.equal(
      result.causeCode,
      'ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING',
      'the original Node refusal is preserved as `cause`'
    );
  });

  // T8 — the control for T7, and for the whole fix. The SAME file content, the
  // SAME plain-node runtime, outside `node_modules`: it loads. Without this,
  // T7 passing is consistent with "plain node cannot load .ts at all", which
  // would make the entire `.ts` restoration useless in the shipped artifact.
  test('the same .ts config loads under plain node OUTSIDE node_modules (control for the case above)', async function(assert) {
    writeFileSync(
      `${basePath}.ts`,
      `const config: { source: string } = { source: 'ts-in-node-modules' };\nexport default config;\n`
    );

    const result = await importConfigInPlainNode(basePath);

    assert.ok(result.ok, 'plain node loads .ts outside node_modules');
    assert.deepEqual(result.value, { source: 'ts-in-node-modules' }, 'returns the default export');
  });

  // T9 — unchanged by #105. A broken config is a broken config, not a missing
  // one and not a declined one. Guards the `catch` from over-reaching: only
  // FILE_TYPE_REFUSAL_CODES are re-framed, everything else propagates.
  test('propagates non-"not found" import errors (syntax error)', async function(assert) {
    writeFileSync(`${basePath}.js`, `export default { this is invalid syntax !!! };\n`);

    try {
      await importConfig(basePath);
      assert.ok(false, 'should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      assert.notOk(message.startsWith(CONFIG_NOT_FOUND_PREFIX), 'not the "not found" error');
      assert.notOk(message.startsWith(CONFIG_NOT_LOADABLE_PREFIX), 'not the "not loadable" error either');
      assert.ok(message.length > 0, 'has an error message');
    }
  });

  // ---------------------------------------------------------------------
  // F-3. WHICH file did the runtime refuse?
  //
  // `FILE_TYPE_REFUSAL_CODES.has(code)` matched on the code alone. A config
  // that loaded and ran perfectly well, but whose own nested `import()` hit a
  // `.ts` under `node_modules`, throws the SAME code — and was re-framed as
  // "this Node runtime refused to load YOUR CONFIG", naming the one file that
  // is not the problem. Measured at this head on node v24.13.0, both codes
  // name the refused file in `message` and expose nothing as an own property
  // (`Object.keys(error)` is `['code']` for both), so the message is the only
  // discriminator available.
  //
  // Both directions are covered. T11 without T12 would be consistent with
  // "the re-frame was removed entirely"; T12 without T11 would be consistent
  // with "the re-frame never fires". Neither alone is worth anything.
  //
  // Plain node throughout: under tsx the nested `.ts` under `node_modules`
  // loads fine and there is no refusal to discriminate.

  // T11 — TRUE POSITIVE. The config file itself is refused. Still re-framed.
  test('re-frames the refusal when the refused file IS the config', async function(assert) {
    const modConfigDir = join(dir, 'node_modules', 'f3-true-positive', 'config');
    mkdirSync(modConfigDir, { recursive: true });
    writeFileSync(
      join(modConfigDir, 'environment.ts'),
      `const config: { source: string } = { source: 'true-positive' };\nexport default config;\n`
    );

    const result = await importConfigInPlainNode(join(modConfigDir, 'environment'));

    assert.notOk(result.ok, 'premise: plain node refuses it');
    assert.ok(
      result.message?.startsWith(CONFIG_NOT_LOADABLE_PREFIX),
      `the config's own refusal is still re-framed, got: ${result.message}`
    );
    assert.ok(
      result.message?.includes('environment.ts'),
      'and the re-framed message names the config file'
    );
    // The refused path is the realpath (`/private/var/...`) while the config
    // path is not (`/var/...`); a plain `===` on the two strings would make
    // this test red. That normalisation is load-bearing, not incidental.
    assert.equal(result.causeCode, 'ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING', 'cause preserved');
  });

  // T12 — FALSE POSITIVE, the actual defect. The config is a perfectly good
  // `.js` OUTSIDE node_modules. It loads. Its own nested import of a `.ts`
  // UNDER node_modules is what the runtime refuses. Before this change the
  // consumer was told their config was unloadable, which is false.
  test('does NOT re-frame when the refused file is something the config imported', async function(assert) {
    const depDir = join(dir, 'node_modules', 'f3-dep');
    mkdirSync(depDir, { recursive: true });
    writeFileSync(join(depDir, 'thing.ts'), `const value: number = 42;\nexport default value;\n`);
    writeFileSync(
      `${basePath}.js`,
      `import thing from '${join(depDir, 'thing.ts')}';\nexport default { source: 'js', thing };\n`
    );

    const result = await importConfigInPlainNode(basePath);

    assert.notOk(result.ok, 'premise: the nested refusal still fails the load');
    assert.notOk(
      result.message?.startsWith(CONFIG_NOT_LOADABLE_PREFIX),
      `must not blame the config, got: ${result.message}`
    );
    assert.notOk(
      result.message?.startsWith(CONFIG_NOT_FOUND_PREFIX),
      'and must not read as absent either'
    );
    assert.ok(
      result.message?.includes('thing.ts'),
      `the untouched Node error names the file actually refused, got: ${result.message}`
    );
    assert.notOk(
      result.message?.includes(`${basePath}.js`),
      'and does not name the config, which loaded fine'
    );
  });
});

/**
 * The `main.ts` half of invariant I2. `src/main.ts` swallows any error whose
 * message starts with `CONFIG_NOT_FOUND_PREFIX` so that a missing test override
 * is non-fatal. The load-bearing property is that it does NOT swallow the
 * declined case — asserted on the boot's re-thrown error, not on stdout.
 *
 * Each boot runs in its own process: `Stonyx` is a process-global singleton
 * (`main.ts:36` returns instance #1 for every later construction and
 * `Stonyx.initialized` never resets), so successive in-process boots would all
 * assert against boot #1.
 */
module('[Unit] importConfig · main.ts test-override catch', function(hooks) {
  hooks.beforeEach(function() {
    dir = mkdtempSync(join(tmpdir(), 'stonyx-test-override-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'my-app', type: 'module' }));
  });

  hooks.afterEach(function() {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeTestConfig(filename: string, contents: string): void {
    mkdirSync(join(dir, 'test', 'config'), { recursive: true });
    writeFileSync(join(dir, 'test', 'config', filename), contents);
  }

  // T10 — AC4. The over-correction guard. Nothing at `test/config/environment.*`
  // at all: still boots. Dies if AC2 is implemented by making every unread
  // config fatal, or if `main.ts`'s swallow is removed outright.
  test('a root with NO test/config/environment.* still boots under NODE_ENV=test', async function(assert) {
    const result = await boot(dir, { port: 4000 });

    assert.equal(result.bootError, null, 'missing test override is non-fatal');
    assert.equal((result.config as { port?: number }).port, 4000, 'the primary config is intact');
  });

  // T11 — AC4-b. The fleet-facing case: a `.ts` test override MERGES again.
  // This is precisely what `beta.82+` silently stopped doing in
  // stonyx-oauth / stonyx-orm / stonyx-rest-server / stonyx-sockets, invisibly,
  // because `main.ts` swallowed the resulting throw.
  test('a .ts test override is loaded and merged under NODE_ENV=test', async function(assert) {
    writeTestConfig(
      'environment.ts',
      `const overrides: { port: number; fromTestConfig: boolean } = { port: 9999, fromTestConfig: true };\nexport default overrides;\n`
    );

    const result = await boot(dir, { port: 4000 });

    assert.equal(result.bootError, null, 'boots');
    assert.equal((result.config as { port?: number }).port, 9999, '.ts override wins over the base config');
    assert.equal((result.config as { fromTestConfig?: boolean }).fromTestConfig, true, 'override keys are merged in');
  });

  // T12 — the control for T11. Same assertion shape against `.js`, which worked
  // throughout the regression. If T11 and T12 are both red the harness is
  // broken, not the code caught.
  test('a .js test override is loaded and merged under NODE_ENV=test (control)', async function(assert) {
    writeTestConfig('environment.js', `export default { port: 9999, fromTestConfig: true };\n`);

    const result = await boot(dir, { port: 4000 });

    assert.equal(result.bootError, null, 'boots');
    assert.equal((result.config as { port?: number }).port, 9999, '.js override wins over the base config');
  });

  // T13 — AC2-c. THE re-throw. A test override present at an extension the
  // loader declines must reach the caller, not be absorbed by the
  // "missing is non-fatal" branch. Dies if `main.ts`'s catch is widened back to
  // a bare `catch {}` or matched on a looser prefix such as 'Config'.
  test('a present-but-not-loadable test override is RE-THROWN, not swallowed', async function(assert) {
    writeTestConfig('environment.mjs', `export default { port: 9999 };\n`);

    const result = await boot(dir, { port: 4000 });

    assert.ok(result.bootError, 'the boot FAILS rather than silently ignoring the file');
    assert.ok(
      result.bootError?.startsWith(CONFIG_NOT_LOADABLE_PREFIX),
      `boot error is the present-but-not-loadable error, got: ${result.bootError}`
    );
    assert.ok(result.bootError?.includes('environment.mjs'), 'names the file the consumer wrote');
  });
});
