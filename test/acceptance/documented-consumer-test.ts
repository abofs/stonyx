/**
 * The regression test abofs/stonyx#108 asks for: build a consumer in the
 * documented shape and BOOT it. Nothing in the suite did that before, which is
 * why the defect survived — every existing test drives `loadModules` directly,
 * and the failure is a second `stonyx` package root in `node_modules`, which
 * only exists in a real tree.
 *
 * Two arms, differing ONLY in the fixtures' installed trees:
 *   - `peer` — one core. POSITIVE CONTROL. Must be green before and after the
 *     fix. A run where both arms are red is a broken harness, not a caught bug.
 *   - `dup`  — one fixture carries its own nested core, which is exactly what
 *     an exact `dependencies.stonyx` pin produces under npm and pnpm alike.
 *
 * THREE constraints, each of which cost a measured run in this cluster before
 * it was written down:
 *
 *  1. Fixtures MUST be `@stonyx/`-scoped. `loadModules` filters on
 *     `startsWith('@stonyx/')`, so unscoped fixtures are silently skipped and
 *     BOTH ARMS PASS VACUOUSLY.
 *  2. The consumer's `package.json#name` must NOT start with `stonyx-`.
 *     `resolveModuleName` keys the standalone transform on the package name, so
 *     a `stonyx-*` consumer has its whole config silently re-nested and
 *     `@stonyx/rest-server` then binds its default port — 2666, the live Trix
 *     daemon.
 *  3. Asserting only that the app BOOTS certifies a mutant. Measured under the
 *     `modules.ts:55` discovery mutation, the consumer still prints its boot
 *     marker and exits 0 with NEITHER module loaded. The discriminating
 *     assertion is the per-module init marker, and it is established by
 *     execution, not by argument.
 *
 * Hermetic by construction: the tree is assembled by copying this repo's own
 * build and its two runtime dependencies into place. No registry, no
 * installer. The cost is that it does not prove "npm produces this tree from
 * these manifests" — that is the group's end-to-end AC (#108 AC4), run against
 * a real `stonyx new` consumer and recorded in the PR body, not here.
 */
import QUnit from 'qunit';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDistIsFresh } from '../helpers/dist-freshness.js';
import { isWalkEntry } from '../../src/util/duplicate-core.js';

const { module, test } = QUnit;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const coreVersion = (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string }).version;

/** The version stamped on the SECOND core in the `dup` arm. */
const DUP_CORE_VERSION = '0.0.0-duplicate';

/** `timeout(1)` does not exist on this host, and `$?` after a pipe is the
 * pipe tail's status. Every boot goes through this. */
const BOOT_DEADLINE_MS = 30_000;

interface BootResult {
  stdout: string;
  stderr: string;
  /** The process's OWN exit code. `null` when it was killed at the deadline. */
  code: number | null;
  killed: boolean;
}

const consumers: string[] = [];

function packageJson(dir: string, contents: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(contents, null, 2));
}

/** Copies this repo's published surface into `<dir>` as a `stonyx` package. */
function installCore(dir: string, version: string): void {
  mkdirSync(dir, { recursive: true });

  for (const entry of [ 'dist', 'config', 'scripts' ]) {
    cpSync(join(repoRoot, entry), join(dir, entry), { recursive: true, dereference: true });
  }

  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as Record<string, unknown>;

  pkg.version = version;
  // A copy assembled by hand must never run the real postinstall.
  delete (pkg.scripts as Record<string, string>).postinstall;
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
}

/**
 * Where a package physically lives, resolved the way node resolves it.
 *
 * Not a hard-coded `node_modules/<name>`: under pnpm only direct dependencies
 * are linked at the top level, so `chalk` — `@stonyx/logs`' only dependency —
 * lives inside the store and a literal path finds nothing. A copy assembled
 * from literal paths boots only under a hoisting installer, which is not the
 * one `stonyx new` uses.
 */
function resolvePackageDir(fromDir: string, name: string): string {
  // REALPATH FIRST — the same narrowing `src/util/duplicate-core.ts` documents
  // and PC-D exists for, and the reason this helper died in `hooks.before` on
  // every pnpm install until abofs/stonyx#119's first fix round. Under pnpm
  // `<repo>/node_modules/@stonyx/logs` is a SYMLINK into
  // `.pnpm/@stonyx+logs@<v>/node_modules/@stonyx/logs`, and `resolve.paths` is
  // purely lexical: it walks the link path, never reaches the store directory
  // where `chalk` actually lives, and the only remaining hit is a `NODE_PATH`
  // entry outside the repo entirely. Node resolves the symlink before resolving
  // the package's own imports; so must this.
  const startDir = realpathSync(fromDir);

  // `require.resolve(name)` is NOT usable here: `@stonyx/utils` publishes only
  // subpath exports and no ".", so resolving it throws
  // ERR_PACKAGE_PATH_NOT_EXPORTED. `resolve.paths` gives the node_modules walk
  // itself, which is what "where does this package live" actually means.
  //
  // ANCESTOR-FILTERED — PC-E's narrowing, for the same reason: `resolve.paths`
  // appends the CJS global folders (`NODE_PATH`, `~/.node_modules`, the node
  // prefix) after the walk, and copying a package out of an ambient `NODE_PATH`
  // into the consumer under test is how the green arm of this file was
  // manufactured before the fix. `isWalkEntry` is the shared predicate.
  for (const nodeModulesDir of createRequire(join(startDir, 'package.json')).resolve.paths(name) ?? []) {
    if (!isWalkEntry(nodeModulesDir, startDir)) continue;

    const candidate = join(nodeModulesDir, name);
    const manifest = join(candidate, 'package.json');

    if (existsSync(manifest) && (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name === name) return candidate;
  }

  throw new Error(`could not locate the package root of "${name}" from ${fromDir} (realpath ${startDir})`);
}

function fixtureSource(slug: string, marker: string): Record<string, string> {
  return {
    'main.js':
      "import config from 'stonyx/config';\n" +
      `console.log('${marker}_LOADED keys=' + Object.keys(config).length);\n` +
      `export default class ${slug} {\n` +
      `  async init() { console.log('${marker}_INIT'); }\n` +
      '}\n',
    'config/environment.js': `export default { ${slug.toLowerCase()}Default: true };\n`,
  };
}

function installFixture(consumer: string, name: string, slug: string, marker: string, arm: 'peer' | 'dup'): void {
  const dir = join(consumer, 'node_modules', name);

  packageJson(dir, {
    name,
    version: '1.0.0',
    type: 'module',
    main: 'main.js',
    keywords: [ 'stonyx-module', 'stonyx-async' ],
    // The manifest half of abofs/stonyx#106 rule 2 vs the shape that produces
    // the defect. The manifests are never installed from — the TREE below is
    // what the runtime sees — but they document which shape each arm models.
    ...(arm === 'dup'
      ? { dependencies: { stonyx: DUP_CORE_VERSION } }
      : { devDependencies: { stonyx: coreVersion }, peerDependencies: { stonyx: `>=${coreVersion}` } }),
  });

  for (const [ relativePath, contents ] of Object.entries(fixtureSource(slug, marker))) {
    const target = join(dir, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }

  // The defect, materialised: an exact pin that cannot dedupe against the
  // app's own copy gets its own physical package root.
  if (arm === 'dup') installCore(join(dir, 'node_modules', 'stonyx'), DUP_CORE_VERSION);
}

function buildConsumer(arm: 'peer' | 'dup'): string {
  assertDistIsFresh('documented-consumer');

  // NEVER `stonyx-*` — see constraint 2 in this file's header.
  const consumer = mkdtempSync(join(tmpdir(), 'stonyx-consumer-'));

  consumers.push(consumer);

  packageJson(consumer, {
    name: 'my-app',
    version: '0.1.0',
    type: 'module',
    scripts: { serve: 'stonyx serve' },
    dependencies: { stonyx: coreVersion },
    devDependencies: { '@stonyx/fixture-alpha': '1.0.0', '@stonyx/fixture-beta': '1.0.0' },
  });

  mkdirSync(join(consumer, 'config'), { recursive: true });
  writeFileSync(join(consumer, 'config', 'environment.js'), 'export default {};\n');
  writeFileSync(join(consumer, 'app.js'), "export default class App {\n  constructor() { console.log('BOOT_OK'); }\n}\n");

  installCore(join(consumer, 'node_modules', 'stonyx'), coreVersion);

  // The core's own two runtime dependencies, plus chalk (@stonyx/logs' only
  // dep), copied out of this repo's install. Dereferenced, because pnpm
  // installs them as symlinks into its store.
  const logsDir = resolvePackageDir(repoRoot, '@stonyx/logs');

  for (const [ dep, from ] of [
    [ '@stonyx/utils', repoRoot ],
    [ '@stonyx/logs', repoRoot ],
    [ 'chalk', logsDir ],
  ] as const) {
    cpSync(resolvePackageDir(from, dep), join(consumer, 'node_modules', dep), { recursive: true, dereference: true });
  }

  installFixture(consumer, '@stonyx/fixture-alpha', 'Alpha', 'FIXTURE_ALPHA', arm);
  installFixture(consumer, '@stonyx/fixture-beta', 'Beta', 'FIXTURE_BETA', 'peer');

  mkdirSync(join(consumer, 'node_modules', '.bin'), { recursive: true });
  symlinkSync(join(consumer, 'node_modules', 'stonyx', 'dist', 'cli.js'), join(consumer, 'node_modules', '.bin', 'stonyx'));

  return consumer;
}

/**
 * Every distinct `stonyx` VERSION physically present under `<consumer>`.
 *
 * Absolute paths throughout. Two measured traps this avoids:
 * `find node_modules -path '*!/node_modules/stonyx'` returns 0 on an npm tree
 * (no leading separator before the top-level `node_modules`), and
 * `require("node_modules/.../package.json")` with a RELATIVE path is resolved
 * as a module id rather than a file — which silently reported 0 distinct
 * versions for a tree that had 3. A1 and A4 are each other's control: the
 * counter is shown reporting 1 on one tree and 2 on the other in the same run.
 */
function coreVersionsOnDisk(dir: string): string[] {
  const found = new Set<string>();

  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const child = join(current, entry.name);
      const manifest = join(child, 'package.json');

      if (existsSync(manifest)) {
        try {
          const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string; version?: string };

          if (pkg.name === 'stonyx' && pkg.version) found.add(pkg.version);
        } catch { /* not a manifest we can read */ }
      }

      walk(child);
    }
  };

  walk(join(dir, 'node_modules'));

  return [ ...found ].sort();
}

/** Runs `stonyx serve` and captures the process's own exit code. */
function bootConsumer(consumer: string): Promise<BootResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    // abofs/stonyx#107: this workspace exports NODE_PATH at a different
    // stonyx, and a live contamination incident was recorded during the
    // refinement of this very cluster.
    const env = { ...process.env };
    delete env.NODE_PATH;

    const child = spawn(process.execPath, [ join(consumer, 'node_modules', '.bin', 'stonyx'), 'serve' ], {
      cwd: consumer,
      env,
      stdio: [ 'ignore', 'pipe', 'pipe' ],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const deadline = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, BOOT_DEADLINE_MS);

    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => { clearTimeout(deadline); rejectPromise(error); });
    child.on('close', code => { clearTimeout(deadline); resolvePromise({ stdout, stderr, code, killed }); });
  });
}

let peerBoot: BootResult;
let peerConsumer: string;
let dupBoot: BootResult;
let dupConsumer: string;

module('[Acceptance] documented consumer — peer arm (positive control)', function(hooks) {
  hooks.before(async function() {
    peerConsumer = buildConsumer('peer');
    peerBoot = await bootConsumer(peerConsumer);
  });

  hooks.after(function() {
    while (consumers.length) rmSync(consumers.pop()!, { recursive: true, force: true });
  });

  test('A1: exactly one distinct stonyx version on disk, equal to the declared version', function(assert) {
    assert.deepEqual(coreVersionsOnDisk(peerConsumer), [ coreVersion ], 'one copy, and it is the declared one');
    assert.ok(existsSync(join(peerConsumer, 'node_modules', '.bin', 'stonyx')), 'and the consumer has a stonyx binary');
  });

  test('A2: stdout carries an init marker for EVERY selected module', function(assert) {
    assert.ok(peerBoot.stdout.includes('FIXTURE_ALPHA_INIT'), `alpha initialised, got: ${peerBoot.stdout}`);
    assert.ok(peerBoot.stdout.includes('FIXTURE_BETA_INIT'), `beta initialised, got: ${peerBoot.stdout}`);
    assert.ok(
      peerBoot.stdout.includes('FIXTURE_ALPHA_LOADED keys=') && !peerBoot.stdout.includes('FIXTURE_ALPHA_LOADED keys=0'),
      'and each read a NON-EMPTY Stonyx.config through `stonyx/config` — the read that fails silently on a second core'
    );
  });

  test('A3: the app boots (BOOT_OK) and the process exits 0', function(assert) {
    assert.ok(peerBoot.stdout.includes('BOOT_OK'), `the app entry point ran, got: ${peerBoot.stdout}\n${peerBoot.stderr}`);
    assert.notOk(peerBoot.killed, 'and it terminated on its own, not at the deadline');
    assert.strictEqual(peerBoot.code, 0, `exit code read from the process itself, stderr: ${peerBoot.stderr}`);
  });
});

module('[Acceptance] documented consumer — dup arm', function(hooks) {
  hooks.before(async function() {
    dupConsumer = buildConsumer('dup');
    dupBoot = await bootConsumer(dupConsumer);
  });

  hooks.after(function() {
    while (consumers.length) rmSync(consumers.pop()!, { recursive: true, force: true });
  });

  test('A4: control — exactly two distinct stonyx versions on disk', function(assert) {
    assert.deepEqual(
      coreVersionsOnDisk(dupConsumer),
      [ DUP_CORE_VERSION, coreVersion ].sort(),
      'the tree really is duplicated — and the same counter reported exactly one for the peer arm'
    );
  });

  test('A5: boot fails with a diagnostic naming the module, both absolute paths and both versions', function(assert) {
    assert.notStrictEqual(dupBoot.code, 0, `the duplicated tree refuses to boot, stdout: ${dupBoot.stdout}`);
    assert.notOk(dupBoot.killed, 'and fails fast rather than hanging to the deadline');
    assert.ok(dupBoot.stderr.includes('@stonyx/fixture-alpha'), 'names the offending module');
    assert.ok(
      dupBoot.stderr.includes(join(dupConsumer, 'node_modules', 'stonyx')),
      'names the running core\'s absolute path'
    );
    assert.ok(
      dupBoot.stderr.includes(join(dupConsumer, 'node_modules', '@stonyx/fixture-alpha', 'node_modules', 'stonyx')),
      'names the second core\'s absolute path'
    );
    assert.ok(dupBoot.stderr.includes(coreVersion), 'names the running core\'s version');
    assert.ok(dupBoot.stderr.includes(DUP_CORE_VERSION), 'names the second core\'s version');
    assert.notOk(dupBoot.stdout.includes('FIXTURE_ALPHA_LOADED'), 'and refused BEFORE evaluating the module');
    // NOT asserted: that the string "Stonyx has not been initialized yet" is
    // absent. The diagnostic QUOTES it deliberately — it is what a consumer
    // has already seen and searched for — and the first draft of this test
    // asserted its absence and red against its own message. What matters is
    // that the consumer is not left holding the downstream symptom instead of
    // the cause, so assert the frame it would have come from is absent.
    assert.notOk(
      dupBoot.stderr.includes('dist/exports/config.js'),
      `the consumer gets the cause, not a stack through the second core's config export, got: ${dupBoot.stderr}`
    );
  });

  test('A6: the diagnostic never mentions config/environment.js', function(assert) {
    assert.notOk(
      dupBoot.stderr.includes('must have a config/environment.js file'),
      `the false claim #108 was filed over is gone, got: ${dupBoot.stderr}`
    );
    assert.notOk(
      dupBoot.stderr.includes('config/environment'),
      'and no part of the message points at a config file at all'
    );
    assert.ok(dupBoot.stderr.includes('peerDependencies'), 'it gives the module author\'s remedy instead');
  });
});
