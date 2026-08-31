// Fresh-clone scaffold acceptance harness — abofs/stonyx#89.
//
// THIS HARNESS MUST LAND RED. It exists to make the defects catalogued on the
// #88 epic observable. Each of #90-#93 turns a named assertion below green.
// Do not "fix" a failing assertion here; fix it in the story that owns it.
//
// Why a fresh clone: every instance of the #88 trap is INVISIBLE from the
// directory where `stonyx new` ran. The mandated file exists there and is
// merely untracked, so the suite is green and the override is inert. The
// defect only becomes observable after `git clone`.
//
// Three vacuity traps this harness is built around — each verified by
// execution, not by reasoning (see the PR body on #89):
//
//   A. `git check-ignore` is INDEX-AWARE. It reports "not ignored" (exit 1)
//      for any tracked path, so with `*.js` fully live a force-added file
//      makes it exit green. In a fresh clone of a fixed repo the file is
//      always tracked, so the plain form CANNOT FAIL there. `--no-index` is
//      required, and it is paired with `git ls-files` because `--no-index`
//      proves the rules permit the file, not that the file is in the repo.
//
//   B. A STALE `dist/` exhibits pre-4c80c87 behaviour. A `dist/util/
//      import-config.js` still carrying `EXTENSIONS = ['ts','js']` resolves
//      the `.ts` override successfully and produces a fully green run of the
//      central assertion from a build artifact predating the code under test.
//      The harness therefore does `rm -rf dist && pnpm build && npm pack` in
//      the same run and installs THAT tarball, never a workspace link.
//
//   C. Under tsx, a `.js` specifier can resolve a `.ts` SIBLING. Verified:
//      the rewrite is importer-dependent — from a `.ts` importer,
//      `import(pathToFileURL('.../cfg.js'))` yields `cfg.ts`; from a `.js`
//      importer inside node_modules it does not. Which file does the import
//      is not something a consumer can reason about, so the harness asserts
//      no sibling pair exists at the override base path.
//
// Gated behind STONYX_ACCEPTANCE=1 because it performs a real `pnpm install`.
import QUnit from 'qunit';
import { promises as fs, existsSync, statSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { spawn, spawnSync, type SpawnSyncReturns } from 'child_process';
import { fileURLToPath } from 'url';
import { scaffoldProject, generateDbSchema, type ModuleOption } from '../../src/cli/new.js';

const { module, test } = QUnit;

const ACCEPTANCE = process.env.STONYX_ACCEPTANCE === '1';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The override base path, relative to the project root. */
const OVERRIDE_BASE = 'test/config/environment';

/** Extensions any config resolver in this ecosystem could plausibly accept. */
const CANDIDATE_EXTENSIONS = ['ts', 'js'] as const;

/**
 * Deliberately does NOT start with `stonyx-`. `resolveModuleName` treats any
 * project whose package.json name begins with `stonyx-` or `@stonyx/` as a
 * standalone stonyx module and wraps its entire config under a module key —
 * which would make the sentinel unreadable for a reason unrelated to #88.
 */
const GENERATED_APP_NAME = 'acceptance-harness-app';

const PRIMARY_SENTINEL = 'PRIMARY-CONFIG-WINS';
const OVERRIDE_SENTINEL = 'TEST-OVERRIDE-WINS';
const SENTINEL_KEY = 'harnessSentinel';

/**
 * `@stonyx/orm` is mandated by #89 ("selecting at least @stonyx/orm"). Sourced
 * from the scaffold's own option list so the harness generates what a real
 * `stonyx new` generates rather than a hand-copied approximation.
 */
const ORM_MODULE: ModuleOption = {
  question: 'Will this project need data management?',
  package: '@stonyx/orm',
  dirs: ['models', 'serializers', 'access', 'transforms', 'hooks'],
  files: { 'config/db-schema.ts': generateDbSchema }
};

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface HarnessState {
  setupError: string | null;
  scratch: string;
  genDir: string;
  cloneDir: string;
  tarball: string;
  extractedPackage: string;
  harnessStart: number;
  distBuiltAt: number;
  /** Extensions the PACKED build's importConfig resolves, in preference order. */
  resolvableExtensions: string[];
  /** The override path the framework under test actually demands, repo-relative. */
  demandedOverridePath: string;
  genFiles: string[];
  cloneFiles: string[];
  lsFiles: string[];
  checkIgnoreNoIndex: number | null;
  checkIgnorePlain: number | null;
  siblingsPresent: string[];
  install: CommandResult;
  build: CommandResult;
  serve: CommandResult;
  boot: { sentinel: string | null; bootError: string | null; raw: string };
  installedRealPath: string;
  cloneRealPath: string;
}

const state: HarnessState = {
  setupError: null,
  scratch: '',
  genDir: '',
  cloneDir: '',
  tarball: '',
  extractedPackage: '',
  harnessStart: 0,
  distBuiltAt: 0,
  resolvableExtensions: [],
  demandedOverridePath: '',
  genFiles: [],
  cloneFiles: [],
  lsFiles: [],
  checkIgnoreNoIndex: null,
  checkIgnorePlain: null,
  siblingsPresent: [],
  install: { status: null, stdout: '', stderr: '' },
  build: { status: null, stdout: '', stderr: '' },
  serve: { status: null, stdout: '', stderr: '' },
  boot: { sentinel: null, bootError: null, raw: '' },
  installedRealPath: '',
  cloneRealPath: ''
};

function run(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): CommandResult {
  const result: SpawnSyncReturns<string> = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: (result.stderr ?? '') + (result.error ? `\n${result.error.message}` : '')
  };
}

/** Exit code only — used for `git check-ignore`, where the code IS the answer. */
function exitCode(command: string, args: string[], cwd: string): number | null {
  return run(command, args, cwd).status;
}

async function listFiles(root: string, skip: string[]): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute);

      if (skip.some(prefix => relative === prefix || relative.startsWith(`${prefix}/`))) continue;

      if (entry.isDirectory()) await walk(absolute);
      else found.push(relative);
    }
  }

  await walk(root);

  return found.sort();
}

/**
 * Ask the PACKED build which config extensions it resolves, by behaviour
 * rather than by reading its source. Runs under plain `node` — never tsx —
 * so trap C cannot colour the answer.
 *
 * This is what makes the trackedness assertions measure the defect instead of
 * hard-coding a filename: today the packed build demands `.js`, so `.js` is
 * the path that must be tracked; once #90 lands and app-owned configs resolve
 * `{ts,js}`, the same code asks for `.ts` and the same assertion goes green.
 */
function probeResolvableExtensions(scratch: string, extractedPackage: string): string[] {
  const probeDir = path.join(scratch, 'probe');
  const importConfigPath = path.join(extractedPackage, 'dist', 'util', 'import-config.js');
  const resolved: string[] = [];

  for (const ext of CANDIDATE_EXTENSIONS) {
    rmSync(probeDir, { recursive: true, force: true });
    mkdirSync(probeDir, { recursive: true });

    // Only this one extension exists, so a success is unambiguous.
    writeFileSync(path.join(probeDir, `cfg.${ext}`), `export default '${ext.toUpperCase()}';\n`);

    const script = [
      `const { importConfig } = await import(${JSON.stringify(importConfigPath)});`,
      `try {`,
      `  const value = await importConfig(${JSON.stringify(path.join(probeDir, 'cfg'))});`,
      `  process.stdout.write('OK:' + String(value));`,
      `} catch (error) {`,
      `  process.stdout.write('ERR:' + error.message);`,
      `}`
    ].join('\n');

    const probe = run('node', ['--input-type=module', '-e', script], scratch);

    if (probe.stdout.startsWith(`OK:${ext.toUpperCase()}`)) resolved.push(ext);
  }

  rmSync(probeDir, { recursive: true, force: true });

  return resolved;
}

function serveSmoke(cloneDir: string): Promise<CommandResult> {
  return new Promise(resolve => {
    const child = spawn('pnpm', ['exec', 'stonyx', 'serve'], { cwd: cloneDir, env: process.env });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });

    // Give the app a boot window, then ask it to shut down cleanly.
    const terminate = setTimeout(() => child.kill('SIGTERM'), 10000);
    const giveUp = setTimeout(() => child.kill('SIGKILL'), 25000);

    child.on('close', status => {
      clearTimeout(terminate);
      clearTimeout(giveUp);
      resolve({ status, stdout, stderr });
    });

    child.on('error', error => {
      clearTimeout(terminate);
      clearTimeout(giveUp);
      resolve({ status: null, stdout, stderr: `${stderr}\n${error.message}` });
    });
  });
}

function cleanup(): void {
  if (!state.scratch) return;
  rmSync(state.scratch, { recursive: true, force: true });
  state.scratch = '';
}

// Belt-and-braces: `after` covers pass and fail, this covers a hard process exit.
process.on('exit', cleanup);

module('[Acceptance] Fresh-clone scaffold (abofs/stonyx#89)', function (hooks) {
  if (!ACCEPTANCE) {
    test('skipped — set STONYX_ACCEPTANCE=1 to run the fresh-clone harness', function (assert) {
      assert.ok(true, 'harness is excluded from the default suite (performs a real pnpm install)');
    });

    return;
  }

  hooks.before(async function () {
    try {
      await runLifecycle();
    } catch (error) {
      // Recorded rather than thrown so every assertion below still reports
      // individually (#89 acceptance criterion 3).
      state.setupError = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    }
  });

  hooks.after(function () {
    cleanup();
  });

  test('precondition: cleanup — scratch directories are created under mkdtemp, never a fixed path', function (assert) {
    assert.strictEqual(state.setupError, null, `harness lifecycle completed\n${state.setupError ?? ''}`);
    assert.ok(state.scratch.startsWith(os.tmpdir()), `scratch root is under the OS temp dir: ${state.scratch}`);
    assert.notStrictEqual(state.scratch, path.join(os.tmpdir(), 'stonyx-acceptance'), 'scratch root is not a predictable shared path');
    assert.ok(/stonyx-89-[^/]+$/.test(state.scratch), `scratch root carries an mkdtemp suffix: ${state.scratch}`);
  });

  test('precondition (trap B): tarball is packed from a dist/ built in this run', function (assert) {
    assert.ok(
      state.distBuiltAt >= state.harnessStart,
      `dist/ was rebuilt during this run (built ${new Date(state.distBuiltAt).toISOString()}, run started ${new Date(state.harnessStart).toISOString()})`
    );

    const packed = path.join(state.extractedPackage, 'dist', 'util', 'import-config.js');
    const local = path.join(REPO_ROOT, 'dist', 'util', 'import-config.js');

    assert.ok(existsSync(packed), 'tarball contains dist/util/import-config.js');
    assert.strictEqual(
      readFileSync(packed, 'utf8'),
      readFileSync(local, 'utf8'),
      'packed import-config.js is byte-identical to the one just built from src/util/import-config.ts'
    );

    const sourceTokens = extensionTokens(readFileSync(path.join(REPO_ROOT, 'src', 'util', 'import-config.ts'), 'utf8'));
    const packedTokens = extensionTokens(readFileSync(packed, 'utf8'));

    assert.deepEqual(
      packedTokens,
      sourceTokens,
      `packed build resolves the same extensions as the current source (source=${JSON.stringify(sourceTokens)}, packed=${JSON.stringify(packedTokens)}) — a mismatch means a stale dist/ is under test`
    );
  });

  test('precondition (trap B): the clone consumes the packed tarball, not a workspace link', function (assert) {
    assert.ok(
      state.installedRealPath.startsWith(path.join(state.cloneRealPath, 'node_modules')),
      `installed stonyx resolves inside the clone's own node_modules, not the working tree: ${state.installedRealPath}`
    );
    assert.notOk(
      state.installedRealPath.startsWith(REPO_ROOT),
      `installed stonyx is not a link back into ${REPO_ROOT}`
    );

    const installed = path.join(state.installedRealPath, 'dist', 'util', 'import-config.js');
    const packed = path.join(state.extractedPackage, 'dist', 'util', 'import-config.js');

    assert.strictEqual(
      readFileSync(installed, 'utf8'),
      readFileSync(packed, 'utf8'),
      'the stonyx the clone actually loads is the tarball built in this run'
    );
  });

  test('precondition: every assertion runs in the clone, not the generation directory', function (assert) {
    assert.notStrictEqual(state.cloneDir, state.genDir, 'clone directory differs from the generation directory');
    assert.ok(existsSync(path.join(state.cloneDir, '.git')), 'clone has its own .git');

    const toplevel = run('git', ['rev-parse', '--show-toplevel'], state.cloneDir).stdout.trim();

    assert.strictEqual(
      existsSync(toplevel) ? statSync(toplevel).ino : -1,
      statSync(state.cloneDir).ino,
      `git toplevel inside the clone is the clone itself (${toplevel})`
    );
  });

  test('precondition (trap C): no .ts/.js sibling pair exists at the test-config override base', function (assert) {
    assert.strictEqual(
      state.siblingsPresent.length,
      1,
      `exactly one file exists at ${OVERRIDE_BASE}.* — found ${JSON.stringify(state.siblingsPresent)}. ` +
      'With a pair present, a `.js` specifier read from a `.ts` importer under tsx resolves the `.ts`, ' +
      'so the sentinel assertion could report success for a file plain node would never load.'
    );
  });

  test('#90/#91 — the test-config override the framework demands is tracked by git', function (assert) {
    assert.ok(
      state.lsFiles.includes(state.demandedOverridePath),
      `git ls-files in the clone contains ${state.demandedOverridePath} ` +
      `(the packed build resolves ${JSON.stringify(state.resolvableExtensions)}, so that is the path it demands). ` +
      `Present in the clone: ${JSON.stringify(state.siblingsPresent)}`
    );
  });

  test('#90/#91 — the test-config override the framework demands is not gitignored', function (assert) {
    // `--no-index` only. The plain form is index-aware and reports "not
    // ignored" for any tracked path, so it cannot fail in a fresh clone.
    assert.strictEqual(
      state.checkIgnoreNoIndex,
      1,
      `git check-ignore --no-index -q ${state.demandedOverridePath} exits 1 (not ignored); ` +
      `got ${state.checkIgnoreNoIndex}. For reference, the index-aware form exits ${state.checkIgnorePlain} ` +
      'and is not evidence of anything here.'
    );
  });

  test('#91 — the clone builds: pnpm build exits 0', function (assert) {
    assert.strictEqual(
      state.build.status,
      0,
      `pnpm build in the clone exits 0; got ${state.build.status}\n${state.build.stdout}\n${state.build.stderr}`
    );
  });

  test('#91 — the clone serves: stonyx serve reaches init and exits 0 on SIGTERM', function (assert) {
    const combined = `${state.serve.stdout}\n${state.serve.stderr}`;

    assert.strictEqual(
      state.serve.status,
      0,
      `stonyx serve exits 0 after SIGTERM; got ${state.serve.status}\n${combined}`
    );
    assert.notOk(
      /Warning: both .* and .* exist/.test(combined),
      `no dual-extension entry-point warning on stderr\n${combined}`
    );
  });

  test('#90 — a sentinel present only in the test override wins over the primary config after a real boot', function (assert) {
    assert.strictEqual(
      state.boot.sentinel,
      OVERRIDE_SENTINEL,
      `Stonyx.instance.config.${SENTINEL_KEY} is the override value after a real boot under NODE_ENV=test; ` +
      `got ${JSON.stringify(state.boot.sentinel)}. Boot error: ${state.boot.bootError ?? 'none'}`
    );
  });

  test('#90/#91 — no file committed in the generation directory is missing from the clone', function (assert) {
    const missing = state.genFiles.filter(file => !state.cloneFiles.includes(file));

    assert.deepEqual(
      missing,
      [],
      'every file the scaffold wrote survives a clone. This is the class-level guard for the ' +
      '#88 trap: a `*.js` / `*.d.ts` ignore rule that silently swallows a mandated source file ' +
      `is invisible in the generation directory and shows up here. Missing: ${JSON.stringify(missing)}`
    );
  });
});

/** Extension tokens a config resolver mentions — the stale-dist tell. */
function extensionTokens(source: string): string[] {
  const matches = source.match(/\.(ts|js)\b/g) ?? [];

  return [...new Set(matches.map(match => match.slice(1)))].sort();
}

async function runLifecycle(): Promise<void> {
  state.harnessStart = Date.now();
  state.scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'stonyx-89-'));
  state.genDir = path.join(state.scratch, 'generated');
  state.cloneDir = path.join(state.scratch, 'clone');

  // 1. Trap B — a tarball from a dist/ built in this run, never an existing one.
  rmSync(path.join(REPO_ROOT, 'dist'), { recursive: true, force: true });

  const build = run('pnpm', ['build'], REPO_ROOT);
  if (build.status !== 0) throw new Error(`pnpm build in ${REPO_ROOT} failed: ${build.stdout}\n${build.stderr}`);

  state.distBuiltAt = statSync(path.join(REPO_ROOT, 'dist', 'util', 'import-config.js')).mtimeMs;

  const pack = run('npm', ['pack', '--json', '--pack-destination', state.scratch], REPO_ROOT);
  if (pack.status !== 0) throw new Error(`npm pack failed: ${pack.stdout}\n${pack.stderr}`);

  state.tarball = path.join(state.scratch, JSON.parse(pack.stdout)[0].filename);

  const extract = run('tar', ['-xzf', state.tarball, '-C', state.scratch], state.scratch);
  if (extract.status !== 0) throw new Error(`tar extract failed: ${extract.stderr}`);

  state.extractedPackage = path.join(state.scratch, 'package');
  state.resolvableExtensions = probeResolvableExtensions(state.scratch, state.extractedPackage);

  // 2. Generate a project, selecting @stonyx/orm.
  await scaffoldProject(state.genDir, GENERATED_APP_NAME, [ORM_MODULE]);

  // 3. Commit it, exactly as a consumer would before pushing.
  const gitEnv = { GIT_AUTHOR_NAME: 'harness', GIT_AUTHOR_EMAIL: 'harness@example.com', GIT_COMMITTER_NAME: 'harness', GIT_COMMITTER_EMAIL: 'harness@example.com' };
  run('git', ['init', '-q', '.'], state.genDir);
  run('git', ['add', '-A'], state.genDir);
  run('git', ['commit', '-q', '-m', 'initial scaffold'], state.genDir, gitEnv);

  // 4. Clone to a SECOND directory. Everything below is asserted here.
  const clone = run('git', ['clone', '-q', state.genDir, state.cloneDir], state.scratch);
  if (clone.status !== 0) throw new Error(`git clone failed: ${clone.stderr}`);

  state.genFiles = await listFiles(state.genDir, ['.git', 'node_modules']);
  state.cloneFiles = await listFiles(state.cloneDir, ['.git', 'node_modules']);

  // 5. Git-state measurements, taken before install so nothing the harness
  //    installs can influence them.
  state.lsFiles = run('git', ['ls-files'], state.cloneDir).stdout.split('\n').filter(Boolean);
  state.siblingsPresent = CANDIDATE_EXTENSIONS
    .map(ext => `${OVERRIDE_BASE}.${ext}`)
    .filter(candidate => existsSync(path.join(state.cloneDir, candidate)));

  const preferred = state.resolvableExtensions.find(ext => state.siblingsPresent.includes(`${OVERRIDE_BASE}.${ext}`));
  state.demandedOverridePath = `${OVERRIDE_BASE}.${preferred ?? state.resolvableExtensions[0] ?? 'js'}`;

  state.checkIgnoreNoIndex = exitCode('git', ['check-ignore', '--no-index', '-q', state.demandedOverridePath], state.cloneDir);
  state.checkIgnorePlain = exitCode('git', ['check-ignore', '-q', state.demandedOverridePath], state.cloneDir);

  // 6. Install the packed tarball into the clone. #92 will make the scaffold
  //    pin an exact version; until then the harness supplies the override.
  await pinTarball(state.cloneDir, state.tarball);
  state.install = run('pnpm', ['install'], state.cloneDir);
  state.installedRealPath = await fs.realpath(path.join(state.cloneDir, 'node_modules', 'stonyx')).catch(() => '');
  state.cloneRealPath = await fs.realpath(state.cloneDir);

  // 7. Build and serve BEFORE any sentinel injection, so an injected sentinel
  //    can never be the reason `tsc` fails.
  state.build = run('pnpm', ['build'], state.cloneDir);
  state.serve = await serveSmoke(state.cloneDir);

  // 8. Sentinel: distinct values in the primary config and in every override
  //    file that exists. No override file is CREATED — creating the one the
  //    resolver wants is the fix, and the fix belongs to #90.
  state.boot = await bootWithSentinels(state.cloneDir);
}

async function pinTarball(cloneDir: string, tarball: string): Promise<void> {
  const manifestPath = path.join(cloneDir, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const specifier = `file:${tarball}`;

  manifest.devDependencies.stonyx = specifier;
  manifest.pnpm = { ...(manifest.pnpm ?? {}), overrides: { ...(manifest.pnpm?.overrides ?? {}), stonyx: specifier } };

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function bootWithSentinels(cloneDir: string): Promise<HarnessState['boot']> {
  const primary = path.join(cloneDir, 'config', 'environment.ts');

  await fs.writeFile(primary, `const config = { ${SENTINEL_KEY}: '${PRIMARY_SENTINEL}' };\nexport default config;\n`);

  for (const ext of CANDIDATE_EXTENSIONS) {
    const override = path.join(cloneDir, `${OVERRIDE_BASE}.${ext}`);
    if (!existsSync(override)) continue;
    await fs.writeFile(override, `const config = { ${SENTINEL_KEY}: '${OVERRIDE_SENTINEL}' };\nexport default config;\n`);
  }

  // A real child process with a real boot. `Stonyx.instance.config` is read
  // after the test-override merge, which main.ts performs before loadModules —
  // so an unrelated module-load failure cannot mask the sentinel result.
  const bootScript = path.join(cloneDir, '.stonyx-89-boot.mjs');

  await fs.writeFile(bootScript, [
    `import { pathToFileURL } from 'url';`,
    `const cwd = process.cwd();`,
    `const { default: Stonyx } = await import('stonyx');`,
    `const { default: config } = await import(pathToFileURL(\`\${cwd}/config/environment.ts\`).href);`,
    `let bootError = null;`,
    `new Stonyx(config, cwd);`,
    `try { await Stonyx.ready; } catch (error) { bootError = error instanceof Error ? error.message : String(error); }`,
    `process.stdout.write('__HARNESS__' + JSON.stringify({`,
    `  sentinel: Stonyx.instance?.config?.${SENTINEL_KEY} ?? null,`,
    `  bootError`,
    `}));`,
    `process.exit(0);`,
    ''
  ].join('\n'));

  // tsx/esm is the loader the generated `test` script uses, so this is the
  // runtime a consumer actually gets. Trap C is closed by the sibling-pair
  // precondition rather than by avoiding tsx here.
  const boot = run('node', ['--import', 'tsx/esm', bootScript], cloneDir, { NODE_ENV: 'test' });
  const marker = boot.stdout.indexOf('__HARNESS__');

  if (marker === -1) {
    return { sentinel: null, bootError: `boot produced no result marker\n${boot.stdout}\n${boot.stderr}`, raw: boot.stdout };
  }

  const parsed = JSON.parse(boot.stdout.slice(marker + '__HARNESS__'.length));

  return { sentinel: parsed.sentinel, bootError: parsed.bootError, raw: boot.stdout };
}
