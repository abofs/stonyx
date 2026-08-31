import QUnit from 'qunit';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { module, test } = QUnit;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// abofs/stonyx#90 — WIRING coverage.
//
// A test of the resolver *function* proves nothing about which resolver each
// call site reaches. These are the two mis-routing directions the story exists
// to prevent:
//
//   AC5 goes red if `src/modules.ts:103` (module-owned) is routed to the
//       app-owned resolver — that is abofs/stonyx-orm#118 / the orm@0.3.1 P0.
//   AC7 goes red if any of `src/cli/serve.ts:45`, `src/cli.ts:48` or
//       `src/cli/test-setup.ts:8` (all app-owned) is left on the module-owned
//       resolver.
//
// `src/main.ts:67` is the fourth app-owned call site; it is covered executably
// by AC8's sentinel in `test/acceptance/fresh-clone-scaffold-test.ts:708-716`.
//
// EVERYTHING HERE RUNS UNDER PLAIN `node`, NEVER tsx, and against the built
// `dist/` installed into a throwaway `node_modules/stonyx`. That is not
// ceremony: tsx rewrites a `foo.js` specifier to `foo.ts` when the sibling
// exists, so an in-process `importModuleConfig(base)` call loads the `.ts`
// under this repo's own test runner and a module-owned assertion written
// in-process reports green on the mis-routed build. Measured, not reasoned —
// the first draft of AC5 did exactly that.
//
// Not covered here, owned by other files:
//   AC6 — `state.resolvableExtensions` deep-equals ["ts","js"], strengthened in
//         place at `test/acceptance/fresh-clone-scaffold-test.ts:636-641`.
//   AC8 — the three `"issue": 90` entries deleted from
//         `test/acceptance/expected-failures.json`; exit condition is
//         `pnpm test:acceptance:ratchet` exiting 0.

const CFG_SENTINEL = 'STONYX_APP_OWNED_TS_CONFIG_LOADED';

let root: string;

interface RunResult {
  stdout: string;
  stderr: string;
  status: number | null;
}

/**
 * Build a throwaway project that looks like a real INSTALL of this repo:
 * `node_modules/stonyx` is the built `dist/` plus the real `package.json`, and
 * the framework's own runtime deps are linked beside it.
 *
 * `config/environment.ts` is written with a TypeScript-only type annotation and
 * NO `.js` sibling, so a run that reaches its sentinel has also proved Node
 * type-stripped an app-root `.ts` imported from a `.js` module living inside
 * `node_modules` — the platform premise the whole story rests on.
 */
function createInstalledApp(name: string, devDependencies: Record<string, string> = {}): string {
  const installed = path.join(root, 'node_modules', 'stonyx');

  mkdirSync(path.join(root, 'config'), { recursive: true });
  mkdirSync(path.join(root, 'node_modules', '@stonyx'), { recursive: true });
  mkdirSync(installed, { recursive: true });

  cpSync(path.join(repoRoot, 'dist'), path.join(installed, 'dist'), { recursive: true });
  cpSync(path.join(repoRoot, 'package.json'), path.join(installed, 'package.json'));

  for (const dep of ['logs', 'utils']) {
    symlinkSync(path.join(repoRoot, 'node_modules', '@stonyx', dep), path.join(root, 'node_modules', '@stonyx', dep));
  }
  symlinkSync(path.join(repoRoot, 'node_modules', 'qunit'), path.join(root, 'node_modules', 'qunit'));

  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name, devDependencies }));
  writeFileSync(
    path.join(root, 'config', 'environment.ts'),
    `const source: string = 'ts';\n` +
    `process.stdout.write('${CFG_SENTINEL}:' + source + '\\n');\n` +
    `export default { port: 4321 };\n`
  );

  return installed;
}

function runInstalled(args: string[], extraEnv: Record<string, string> = {}): RunResult {
  const env = { ...process.env };
  delete env.NODE_ENV;
  // Pin the no-tsx isolation explicitly rather than relying on `--import tsx`
  // living in argv: an exported NODE_OPTIONS would otherwise reach the child.
  delete env.NODE_OPTIONS;
  Object.assign(env, extraEnv);

  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env, timeout: 120000 });

  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status };
}

function report(result: RunResult): string {
  return `\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`;
}

module('[Unit] #90 wiring — module-owned call sites stay on the .js-only resolver', function(hooks) {
  hooks.beforeEach(function() {
    root = mkdtempSync(path.join(tmpdir(), 'stonyx-wiring-module-'));
  });

  hooks.afterEach(function() {
    rmSync(root, { recursive: true, force: true });
  });

  // AC5. The fake module ships BOTH extensions in its own `config/`, and an
  // identical pair is planted at an app-owned path. The two resolvers give
  // different answers for the same pair, so the assertion can discriminate.
  test('AC5 loadModules resolves a module config through the .js-only path when both .ts and .js exist', function(assert) {
    const moduleName = '@stonyx/fake-mod';
    const installed = createInstalledApp('wiring-module-app', { [moduleName]: '1.0.0' });
    const modulePath = path.join(root, 'node_modules', moduleName);
    const moduleConfigBase = path.join(modulePath, 'config', 'environment');
    const appConfigBase = path.join(root, 'probe', 'environment');

    const both = (base: string): void => {
      writeFileSync(`${base}.js`, `export default { source: 'js' };\n`);
      writeFileSync(`${base}.ts`, `const source: string = 'ts';\nexport default { source };\n`);
    };

    mkdirSync(path.join(modulePath, 'config'), { recursive: true });
    mkdirSync(path.join(root, 'probe'), { recursive: true });
    writeFileSync(
      path.join(modulePath, 'package.json'),
      JSON.stringify({ name: moduleName, main: 'index.js', keywords: ['stonyx-module', 'stonyx-async'] })
    );
    writeFileSync(path.join(modulePath, 'index.js'), 'export default class FakeMod {}\n');
    both(moduleConfigBase);
    both(appConfigBase);

    // Probe the INSTALLED build the way the #89 harness does — by behaviour,
    // through `dist/util/import-config.js`, under plain node.
    const probe = [
      `const installed = ${JSON.stringify(installed)};`,
      `const { importConfig } = await import(installed + '/dist/util/import-config.js');`,
      `const appOwned = await importConfig(${JSON.stringify(appConfigBase)});`,
      `process.stdout.write('APP_OWNED:' + appOwned.source + '\\n');`,
      `const primary = await importConfig(${JSON.stringify(path.join(root, 'config', 'environment'))});`,
      `const { default: Stonyx } = await import('stonyx');`,
      `new Stonyx(primary, ${JSON.stringify(root)});`,
      `await Stonyx.ready;`,
      `process.stdout.write('MODULE_OWNED:' + JSON.stringify(Stonyx.instance.config.fakeMod) + '\\n');`
    ].join('\n');

    const result = runInstalled(['--input-type=module', '-e', probe]);

    // The check could have failed: on an IDENTICAL pair at an app-owned path
    // the same build answers 'ts'. Without this, "got js" would also be the
    // answer for a fixture that never had a .ts to prefer, or for a build with
    // no app-owned resolver at all.
    assert.ok(
      result.stdout.includes('APP_OWNED:ts'),
      `precondition: the app-owned resolver prefers the .ts on an identical sibling pair${report(result)}`
    );

    assert.ok(
      result.stdout.includes('MODULE_OWNED:{"source":"js"}'),
      'loadModules took the .js — src/modules.ts:103 is on the module-owned resolver. ' +
      'A "ts" here, or an ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING crash, means the ' +
      `module-owned call site was rerouted to the app-owned resolver, which re-ships abofs/stonyx-orm#118.${report(result)}`
    );
  });
});

function assertReachedAppOwnedResolver(assert: Assert, label: string, result: RunResult): void {
  assert.ok(
    result.stdout.includes(`${CFG_SENTINEL}:ts`),
    `${label} imported <cwd>/config/environment.ts${report(result)}`
  );
  assert.notOk(
    /Config not found/.test(result.stderr),
    `${label} did not fall through to the module-owned ".js only" resolver${report(result)}`
  );
}

module('[Unit] #90 wiring — app-owned CLI call sites reach the {ts,js} resolver', function(hooks) {
  hooks.beforeEach(function() {
    root = mkdtempSync(path.join(tmpdir(), 'stonyx-wiring-app-'));
  });

  hooks.afterEach(function() {
    rmSync(root, { recursive: true, force: true });
  });

  // AC7 — src/cli/serve.ts:45
  test('AC7 serve resolves <cwd>/config/environment.ts when no .js sibling exists', function(assert) {
    const installed = createInstalledApp('wiring-serve-app');

    // resolveEntryPoint runs BEFORE importConfig in serve(), so the entry must exist.
    writeFileSync(path.join(root, 'app.js'), `process.stdout.write('APP_ENTRY_LOADED\\n');\nprocess.exit(0);\n`);

    const result = runInstalled([path.join(installed, 'dist', 'cli.js'), 'serve']);

    assertReachedAppOwnedResolver(assert, 'stonyx serve', result);
    assert.ok(result.stdout.includes('APP_ENTRY_LOADED'), `serve went on to boot the app${report(result)}`);
  });

  // AC7 — src/cli.ts:48, the `bootstrap: true` module-command path. Every ORM
  // `db:*` command comes through here.
  test('AC7 cli bootstrap resolves <cwd>/config/environment.ts when no .js sibling exists', function(assert) {
    const moduleName = '@stonyx/wiring-mod';
    const installed = createInstalledApp('wiring-cli-app', { [moduleName]: '1.0.0' });
    const modulePath = path.join(root, 'node_modules', moduleName);

    mkdirSync(modulePath, { recursive: true });
    writeFileSync(
      path.join(modulePath, 'package.json'),
      JSON.stringify({ name: moduleName, exports: { './commands': './commands.js' } })
    );
    writeFileSync(
      path.join(modulePath, 'commands.js'),
      `export default {\n` +
      `  'wiring:cmd': {\n` +
      `    description: 'bootstrap probe',\n` +
      `    bootstrap: true,\n` +
      `    run: async () => { process.stdout.write('BOOTSTRAP_CMD_RAN\\n'); process.exit(0); }\n` +
      `  }\n` +
      `};\n`
    );

    const result = runInstalled([path.join(installed, 'dist', 'cli.js'), 'wiring:cmd']);

    assertReachedAppOwnedResolver(assert, 'stonyx <module command> (bootstrap: true)', result);
    assert.ok(result.stdout.includes('BOOTSTRAP_CMD_RAN'), `the bootstrapped module command ran${report(result)}`);
  });

  // AC7 — src/cli/test-setup.ts:8, the `--import` hook `stonyx test` installs.
  test('AC7 test-setup resolves <cwd>/config/environment.ts when no .js sibling exists', function(assert) {
    const installed = createInstalledApp('wiring-test-setup-app');

    const setupFile = path.join(installed, 'dist', 'cli', 'test-setup.js');
    const result = runInstalled(['--import', pathToFileURL(setupFile).href, '-e', '']);

    assertReachedAppOwnedResolver(assert, 'stonyx test-setup', result);
  });
});

// abofs/stonyx#90 — the `src/main.ts:70-73` SWALLOW BOUNDARY.
//
// `main.ts` catches errors out of `importConfig(<root>/test/config/environment)`
// and re-throws anything whose message does not start with `Config not found:`.
// This PR changes what reaches that catch, and the change is invisible in a
// test of `importConfig` alone:
//
//   BEFORE — the resolver asked for `.js` only, so a `test/config/environment.ts`
//     raised `Config not found: …environment.js`, matched the prefix, and the
//     override was SILENTLY SKIPPED. Boot succeeded, unmerged.
//   AFTER  — the `.ts` is imported. It is now merged (the point of the story),
//     and if it contains NON-ERASABLE TypeScript (`enum`, `namespace`,
//     parameter properties, decorators) Node throws
//     ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX, which does NOT match the prefix and
//     propagates out of `Stonyx.ready` as a hard boot failure.
//
// That is a real behaviour change for any consumer already carrying such a
// file (measured on this PR's build: HEAD BOOT_FAILED, BASE BOOT_OK), and it
// is documented in `docs/conventions/framework-modules.md`. AC4 covers
// propagation out of `importConfig`; these three tests cover the line that
// actually changed meaning — the swallow itself.
//
// All three run under plain `node` against the built `dist/` for the same
// reason the tests above do: under tsx the `.js` specifier is rewritten and
// the boundary cannot be observed.

const BOOT_PROBE = (installed: string, rootPath: string): string => [
  `const { importConfig } = await import(${JSON.stringify(path.join(installed, 'dist', 'util', 'import-config.js'))});`,
  `const primary = await importConfig(${JSON.stringify(path.join(rootPath, 'config', 'environment'))});`,
  `const { default: Stonyx } = await import('stonyx');`,
  `new Stonyx(primary, ${JSON.stringify(rootPath)});`,
  `try {`,
  `  await Stonyx.ready;`,
  `  process.stdout.write('BOOT_OK:' + JSON.stringify(Stonyx.instance.config.port) + '\\n');`,
  `} catch (err) {`,
  `  process.stdout.write('BOOT_FAILED:' + (err && err.code ? err.code : 'NO_CODE') + '|' + (err && err.message ? err.message : String(err)) + '\\n');`,
  `}`
].join('\n');

module('[Unit] #90 wiring — main.ts test-override swallow boundary', function(hooks) {
  hooks.beforeEach(function() {
    root = mkdtempSync(path.join(tmpdir(), 'stonyx-wiring-main-'));
  });

  hooks.afterEach(function() {
    rmSync(root, { recursive: true, force: true });
  });

  function writeTestOverride(body: string): void {
    mkdirSync(path.join(root, 'test', 'config'), { recursive: true });
    writeFileSync(path.join(root, 'test', 'config', 'environment.ts'), body);
  }

  function boot(installed: string): RunResult {
    return runInstalled(['--input-type=module', '-e', BOOT_PROBE(installed, root)], { NODE_ENV: 'test' });
  }

  // The swallow still swallows. `main.ts:72` must keep matching the app-owned
  // resolver's new `Config not found: <base>.{ts,js}` message, or every app
  // without a test override would fail to boot under NODE_ENV=test.
  test('an absent test/config/environment is still non-fatal under NODE_ENV=test', function(assert) {
    const installed = createInstalledApp('wiring-main-absent-app');

    const result = boot(installed);

    assert.ok(
      result.stdout.includes('BOOT_OK:4321'),
      `boot succeeded on the primary config alone; main.ts:72 still matches the {ts,js} "Config not found:" message${report(result)}`
    );
  });

  // The check could have failed the other way: an erasable `.ts` override is
  // genuinely imported and merged now. Without this, the failure below would
  // not distinguish "non-erasable syntax throws" from "a .ts override is
  // simply broken".
  test('an erasable test/config/environment.ts is imported and merged', function(assert) {
    const installed = createInstalledApp('wiring-main-erasable-app');
    writeTestOverride(`const port: number = 9876;\nexport default { port };\n`);

    const result = boot(installed);

    assert.ok(
      result.stdout.includes('BOOT_OK:9876'),
      `the .ts test override overrode the primary config's port (4321 -> 9876)${report(result)}`
    );
  });

  // The behaviour change. Before this PR this file produced
  // `Config not found: …environment.js`, was swallowed, and boot succeeded
  // with the override silently dropped.
  test('a NON-ERASABLE test/config/environment.ts fails the boot instead of being swallowed', function(assert) {
    const installed = createInstalledApp('wiring-main-nonerasable-app');
    writeTestOverride(`enum Mode { Test = 'test' }\nexport default { port: 9876, mode: Mode.Test };\n`);

    const result = boot(installed);

    assert.ok(
      result.stdout.includes('BOOT_FAILED:'),
      `Stonyx.ready rejected rather than swallowing the error${report(result)}`
    );
    assert.notOk(
      result.stdout.includes('BOOT_OK'),
      `the override was NOT silently skipped — that is the pre-#90 behaviour${report(result)}`
    );
    assert.ok(
      /ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX|not supported in strip-only mode|TypeScript/.test(result.stdout),
      `the propagated error is the type-stripping failure, not a "Config not found:"${report(result)}`
    );
    assert.notOk(
      result.stdout.includes('BOOT_FAILED:NO_CODE|Config not found'),
      `main.ts:72's prefix match did not absorb it${report(result)}`
    );
  });
});
