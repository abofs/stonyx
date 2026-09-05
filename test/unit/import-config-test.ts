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
  refusalIsAboutTheConfig,
  CONFIG_NOT_FOUND_PREFIX,
  CONFIG_NOT_LOADABLE_PREFIX,
} from '../../src/util/import-config.js';
import { assertDistIsFresh, staleDistArtifacts } from '../helpers/dist-freshness.js';

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
async function importConfigInPlainNode(base: string, nodeFlags: string[] = []): Promise<PlainNodeResult> {
  // F-5. This asserts against `dist/`, so a stale `dist/` makes the assertion
  // meaningless rather than merely wrong. Measured: with M2 applied to `src/`
  // and the build skipped, every one of these tests passed.
  assertDistIsFresh('importConfigInPlainNode');

  const { stdout, stderr } = await execFileAsync(
    'node',
    [ ...nodeFlags, plainNodeScript, base ],
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
  assertDistIsFresh('boot');

  const { stdout, stderr } = await execFileAsync(
    'node',
    [ '--import', 'tsx', bootScript, rootPath, JSON.stringify(config) ],
    { env: { ...process.env, NODE_ENV: 'test' }, timeout: SUBPROCESS_TIMEOUT_MS, killSignal: 'SIGKILL' }
  );

  const marker = stdout.split('__STONYX_BOOT__')[1];
  if (!marker) throw new Error(`boot produced no result. stdout: ${stdout}\nstderr: ${stderr}`);

  return JSON.parse(marker) as BootResult;
}

/**
 * F-5. The freshness guard the plain-node tests never had.
 *
 * `pnpm test` is `pnpm build && qunit`, so CI always ran a fresh `dist/` and
 * this hole was invisible there. It is not invisible in watch mode or an IDE
 * runner, both of which invoke the qunit binary directly. Measured at this
 * head, before the guard: apply M2 (`LOADABLE_EXTENSIONS` -> `[ 'js', 'ts' ]`)
 * to `src/util/import-config.ts`, skip the build, run
 *   node --import tsx node_modules/qunit/bin/qunit.js 'test/**\/*-test.ts'
 * -> rc=0, 115 pass / 0 fail. The mutation `b9d087a` exists to catch survived
 * because every plain-node assertion was reading last build's artifact.
 *
 * The remedy for a defect about untrustworthy evidence contained a smaller
 * copy of that same defect. Its own control is in the commit message.
 */
module('[Unit] dist freshness', function() {
  test('dist/ is built from the src/ in this working tree', function(assert) {
    const stale = staleDistArtifacts();

    assert.deepEqual(
      stale,
      [],
      `every plain-node test in this repo asserts against dist/; if this list is non-empty they are ` +
      `asserting against code that is not in src/. Run \`pnpm build\`. Stale: ${stale.join('; ')}`
    );
  });
});

/**
 * `refusalIsAboutTheConfig` directly. Driving it through `importConfig` covers
 * the two path-comparison outcomes (T11/T12) and NOTHING else.
 *
 * The predicate's FAIL DIRECTION is the property under test here, not any one
 * message shape. `true` means "re-frame this as a refusal of the config" —
 * which is F-3 — so "I could not parse this message" must return `false` and
 * let Node's own error through. Every gap in the two extraction patterns is
 * then a lost re-framing rather than a wrong filename, and a pattern edit
 * cannot silently restore the pre-F-3 behaviour.
 *
 * That is why the negative cases below outnumber the positive ones, and why
 * the `file://` positive case is load-bearing: when the fallback returned
 * `true`, deleting the `file://` alternation left the suite green, because a
 * test asserting `true` cannot tell "the branch worked" from "nothing was
 * extracted and the fallback fired".
 */
module('[Unit] refusalIsAboutTheConfig', function() {
  const configPath = '/tmp/app/config/environment.ts';

  test('true when the refusal names the config as a bare path', function(assert) {
    assert.true(refusalIsAboutTheConfig(
      `Unknown file extension ".ts" for ${configPath}`, configPath
    ));
  });

  test('true when the refusal names the config as a quoted path', function(assert) {
    assert.true(refusalIsAboutTheConfig(
      `Stripping types is currently unsupported for files under node_modules, for "${configPath}"`,
      configPath
    ));
  });

  // Node emits BOTH shapes for the same code. Measured at this head: driven
  // through `importConfig` directly the path is bare, but through `loadModules`
  // the same error names `file:///private/var/...`. Deleting the `file://`
  // branch on the strength of the first two samples would have been wrong.
  test('true when the refusal names the config as a file:// URL', function(assert) {
    assert.true(refusalIsAboutTheConfig(
      `Stripping types is currently unsupported for files under node_modules, for "file://${configPath}"`,
      configPath
    ));
  });

  test('false when the refusal names a DIFFERENT file (the F-3 false positive)', function(assert) {
    assert.false(refusalIsAboutTheConfig(
      `Stripping types is currently unsupported for files under node_modules, for "/tmp/app/node_modules/dep/thing.ts"`,
      configPath
    ));
  });

  // Reaches the `realPath` catch: neither path exists, so `realpathSync`
  // throws for both and the fallback comparison must still say "not ours".
  // Without the catch this is an ENOENT crash instead of a verdict.
  test('false, not a crash, when neither path exists on disk', function(assert) {
    assert.false(refusalIsAboutTheConfig(
      `Unknown file extension ".ts" for /nope/does/not/exist.ts`, configPath
    ));
  });

  // F-7. The `false`-expecting case for the shape `loadModules` actually
  // emits. Without this, the only `file://` test asserted `true` — and `true`
  // is also what the "nothing extracted" fallback used to return, so deleting
  // the `(?:file:\/\/)?` alternation left the suite at 124 pass / 0 fail
  // while reintroducing the F-3 false positive in production.
  test('false when a file:// refusal names a DIFFERENT file', function(assert) {
    assert.false(refusalIsAboutTheConfig(
      `Stripping types is currently unsupported for files under node_modules, for "file:///tmp/app/node_modules/dep/thing.ts"`,
      configPath
    ));
  });

  // F-7, the widened patterns. The old body class excluded space, parens and
  // quotes, so these four either failed extraction (verdict `true` — F-3
  // verbatim) or backtracked onto an earlier `.` and compared a truncated
  // non-path (verdict `false` — the I2 re-framing silently lost). Measured
  // end-to-end through dist/ before the fix: `/tmp/<x>/plain/...` was correct
  // and `/tmp/<x>/My Project/...` was not, one character apart.
  const spacedConfig = '/tmp/my apps/v1.2/app (2)/config/environment.ts';

  test('true when the refusal names a config whose path has a space or parens', function(assert) {
    assert.true(refusalIsAboutTheConfig(
      `Stripping types is currently unsupported for files under node_modules, for "${spacedConfig}"`,
      spacedConfig
    ), 'quoted shape');
    assert.true(refusalIsAboutTheConfig(
      `Unknown file extension ".ts" for ${spacedConfig}`, spacedConfig
    ), 'bare shape — no quotes to bound the path, so the message tail does');
  });

  test('false when a space-or-paren path refusal names a DIFFERENT file', function(assert) {
    assert.false(refusalIsAboutTheConfig(
      `Stripping types is currently unsupported for files under node_modules, for "/tmp/my apps/v1.2/app (2)/node_modules/dep/thing.ts"`,
      spacedConfig
    ), 'quoted shape — must not truncate onto the v1.2 dot and compare a stub');
    assert.false(refusalIsAboutTheConfig(
      `Unknown file extension ".ts" for /tmp/my apps/v1.2/app (2)/node_modules/dep/thing.ts`,
      spacedConfig
    ), 'bare shape');
  });

  test('true when the config path itself contains a quote', function(assert) {
    const quoted = "/tmp/stone's apps/config/environment.ts";

    assert.true(refusalIsAboutTheConfig(
      `Stripping types is currently unsupported for files under node_modules, for "${quoted}"`,
      quoted
    ), 'the quoted pattern runs to the message-final quote, not the first one');
  });

  // THE fail-direction test. This is the whole point of F-7: an unparseable
  // message must NOT be re-framed as "your config was refused", because that
  // sentence names a file the runtime never complained about. Flipping this
  // back to `true` is flipping the bug back on.
  test('false when no path can be extracted at all, so the raw error propagates', function(assert) {
    assert.false(
      refusalIsAboutTheConfig('the runtime said no', configPath),
      'an unrecognised shape must not be re-framed as a refusal of the config'
    );
    assert.false(
      refusalIsAboutTheConfig('Unknown file extension ".ts" for C:\\app\\environment.ts', configPath),
      'a Windows path is not extracted; the consumer gets Node\'s own message, not a wrong filename'
    );
  });

  // Pins the leading-context class `(?:^|\s)`. Without it the bare pattern
  // starts at the first `/` anywhere in the message, so a RELATIVE path is
  // promoted to an absolute one — and this message's absolute suffix is
  // exactly the config, so the promotion would claim the config was refused.
  test('a relative path in the message is not promoted to an absolute one', function(assert) {
    assert.false(refusalIsAboutTheConfig(
      `Unknown file extension ".ts" for lib${configPath}`, configPath
    ), 'lib/tmp/app/... must not be read as /tmp/app/...');
  });

  // Pins `\.[A-Za-z0-9]+` on the bare pattern. Both patterns are greedy and
  // neither is `$`-anchored; the extension requirement is what makes the bare
  // one stop at the end of a path rather than run on into whatever Node
  // appends after it.
  test('true when the refusal names the config with trailing text after the path', function(assert) {
    assert.true(refusalIsAboutTheConfig(
      `Unknown file extension ".ts" for ${configPath} on this runtime`, configPath
    ));
  });
});

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
  // loader will not read is NOT "not found". Dies if the UNRESOLVED_EXTENSIONS
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

  // ---------------------------------------------------------------------
  // T13 — F-4. The `sibling` clause: both files present AND the `.ts` refused.
  //
  // It had ZERO coverage. Replacing the whole clause with `''` left the suite
  // at 113 pass / 0 fail, so nothing observed the branch at all.
  //
  // It is reachable: plain node, both files under `node_modules`. And it is a
  // deliberate BEHAVIOUR CHANGE. Measured against the pre-#105 loader
  // (`${basePath}.js` unconditionally — `git show dev:src/util/import-config.ts`)
  // on this same fixture under plain node, it returned `{ source: 'js' }` and
  // booted. At this head it is a hard failure. The population most likely to
  // hold both files is the one that worked around #105 by renaming to `.js`
  // while the postinstall kept writing the `.ts` stub, so this is not a
  // theoretical state.
  //
  // The clause also contradicted its neighbour: the both-present `console.warn`
  // on the SAME call says "delete the .js", and here the `.js` is the only file
  // this runtime can read. Both messages are asserted together below, because
  // the defect was in their RELATIONSHIP, not in either one alone.
  test('names the opposite remedy to the both-present warning when the .ts is refused', async function(assert) {
    const modConfigDir = join(dir, 'node_modules', 'f4-both', 'config');
    mkdirSync(modConfigDir, { recursive: true });
    writeFileSync(
      join(modConfigDir, 'environment.ts'),
      `const config: { source: string } = { source: 'ts' };\nexport default config;\n`
    );
    writeFileSync(join(modConfigDir, 'environment.js'), `export default { source: 'js' };\n`);

    const configBase = join(modConfigDir, 'environment');
    const result = await importConfigInPlainNode(configBase);

    // Premise: the pre-#105 loader LOADED this state. If it did not, the
    // "behaviour change" framing below would be wrong.
    assert.notOk(result.ok, 'premise: at this head the state is a hard failure');
    assert.ok(
      result.message?.startsWith(CONFIG_NOT_LOADABLE_PREFIX),
      `reported as present-but-not-loadable, got: ${result.message}`
    );

    // The warning fired on the same call, and it says delete the .js.
    assert.strictEqual(result.warnings.length, 1, 'the both-present warning fired on this same call');
    assert.ok(
      result.warnings[0]?.includes('delete the .js'),
      `premise for the contradiction: the warning does say "delete the .js", got: ${result.warnings[0]}`
    );

    // ...so the error must explicitly overrule it, or the consumer gets two
    // instructions and the wrong one is the louder, friendlier-looking one.
    assert.ok(
      result.message?.includes('Disregard the "delete the .js" warning above'),
      `the error overrules the warning by name, got: ${result.message}`
    );
    assert.ok(
      result.message?.includes(`remove or compile ${configBase}.ts`),
      'and names the opposite remedy: remove the .ts, not the .js'
    );
    assert.ok(
      result.message?.includes('this runtime CAN read it'),
      'and says the .js is readable, which is why "delete the .js" would make it worse'
    );
    assert.ok(
      result.message?.includes('beta.95 loaded the .js here'),
      'and discloses that this state used to boot — the change is deliberate, not a surprise'
    );
  });

  // ---------------------------------------------------------------------
  // T15 — F-6. `ERR_UNKNOWN_FILE_EXTENSION` in `FILE_TYPE_REFUSAL_CODES`.
  //
  // The PR body called this one untestable "because this environment does not
  // have a Node without type stripping". That was wrong, and the cost of it
  // being wrong was a set member no test could reach: deleting
  // `'ERR_UNKNOWN_FILE_EXTENSION'` from the set left the suite at 116 pass /
  // 0 fail. An unreachable branch in the guard that exists to make failures
  // loud is the same defect the guard is for.
  //
  // The runtime is reachable with a flag on this exact Node (v24.13.0):
  // `--no-experimental-strip-types` turns off type stripping, and the same
  // `.ts` config then produces
  //   Unknown file extension ".ts" for /private/tmp/…/environment.ts
  // instead of loading. That is precisely the runtime every consumer on a Node
  // without type stripping is on, so this is not a contrived flag — it is the
  // only way to simulate that fleet from here.
  test('a .ts config on a runtime with no type stripping is loud, not absent (ERR_UNKNOWN_FILE_EXTENSION)', async function(assert) {
    writeFileSync(
      `${basePath}.ts`,
      `const config: { source: string } = { source: 'ts' };\nexport default config;\n`
    );

    const result = await importConfigInPlainNode(basePath, [ '--no-experimental-strip-types' ]);

    assert.notOk(result.ok, 'premise: without type stripping the .ts does not load');
    assert.ok(
      result.message?.startsWith(CONFIG_NOT_LOADABLE_PREFIX),
      `re-framed as present-but-not-loadable, got: ${result.message}`
    );
    assert.notOk(
      result.message?.startsWith(CONFIG_NOT_FOUND_PREFIX),
      'and NOT as absent — which is the whole point of I2'
    );
    assert.equal(
      result.causeCode,
      'ERR_UNKNOWN_FILE_EXTENSION',
      'the second FILE_TYPE_REFUSAL_CODES member is the one that fired'
    );
  });

  // T16 — the control for T15, and for the flag itself. The SAME plain-node
  // runtime WITHOUT the flag loads the same file. Without this, T15 passing is
  // consistent with "the harness is broken and nothing loads under plain node".
  test('the same .ts config loads on the same runtime with type stripping on (control)', async function(assert) {
    writeFileSync(
      `${basePath}.ts`,
      `const config: { source: string } = { source: 'ts' };\nexport default config;\n`
    );

    const result = await importConfigInPlainNode(basePath);

    assert.ok(result.ok, 'loads with type stripping on');
    assert.deepEqual(result.value, { source: 'ts' }, 'returns the default export');
  });

  // T14 — the control for T13's `sibling` half. SAME refused `.ts`, no `.js`
  // beside it. The clause must NOT fire: there is no sibling to disregard a
  // warning about, and no warning was printed. Without this, T13 is consistent
  // with the clause being appended unconditionally.
  test('does not mention a sibling .js when there is no sibling .js', async function(assert) {
    const modConfigDir = join(dir, 'node_modules', 'f4-only-ts', 'config');
    mkdirSync(modConfigDir, { recursive: true });
    writeFileSync(
      join(modConfigDir, 'environment.ts'),
      `const config: { source: string } = { source: 'ts' };\nexport default config;\n`
    );

    const result = await importConfigInPlainNode(join(modConfigDir, 'environment'));

    assert.notOk(result.ok, 'premise: still a hard failure');
    assert.ok(result.message?.startsWith(CONFIG_NOT_LOADABLE_PREFIX), 'still present-but-not-loadable');
    assert.strictEqual(result.warnings.length, 0, 'no both-present warning, because there is no both');
    assert.notOk(
      result.message?.includes('Disregard the "delete the .js" warning above'),
      `no sibling clause, got: ${result.message}`
    );
    assert.notOk(result.message?.includes('also exists and this runtime CAN read it'), 'no sibling clause');
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
