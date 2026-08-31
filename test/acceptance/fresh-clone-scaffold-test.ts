// Fresh-clone scaffold acceptance harness — abofs/stonyx#89.
//
// THIS HARNESS MUST LAND RED. It exists to make the defects catalogued on the
// #88 epic observable. Do not "fix" a failing assertion here; fix it in the
// story that owns it.
//
// Assertion -> owning story. This map is the whole claim, and it is narrower
// than "each of #90-#93 turns a named assertion green" — two of the four
// children are only partly observable from a fresh-clone lifecycle:
//
//   #90 -> "the test-config override ... is tracked by git"
//          "the test-config override ... is not gitignored"
//          "a sentinel present only in the test override wins ..."
//   #91 -> "the clone builds"
//          "the clone serves"
//   #92 -> "the scaffold pins an exact stonyx version and emits pnpm.overrides"
//          (the harness captures what the scaffold emitted BEFORE overwriting
//          it with the packed tarball, so #92's deliverable is observable
//          rather than masked by the harness's own pin)
//   #93 -> NO ASSERTION HERE. #93 is a machine-derived completeness guard over
//          the test-config surface; nothing in a fresh-clone lifecycle observes
//          it. #93 must be verified by its own tests, not against this harness.
//
// The clone-parity assertion belongs to no single story: it is the class-level
// guard for the `*.js` / `*.d.ts` swallow, and it passes today.
//
// EXPECTED-FAILURES RATCHET. `test/acceptance/expected-failures.json` records
// the assertions currently permitted to fail. `scripts/acceptance-ratchet.js`
// diffs the observed red set against it IN BOTH DIRECTIONS — a new failure is
// red, and an assertion that starts passing without the baseline shrinking is
// also red. Each of #90-#92 must shrink that file in its own PR.
//
// SIDE EFFECTS — this harness is not read-only. It deletes and rebuilds THIS
// REPO'S OWN `dist/`, performs a real network `pnpm install`, and binds a TCP
// port. That is why it is gated behind STONYX_ACCEPTANCE=1.
//
// SETUP FAILURES ARE NOT ASSERTION RESULTS. Every shell-out in the lifecycle
// checks its status and throws; a thrown lifecycle is recorded in
// `state.setupError` and every test below reports it as a HARNESS SETUP
// FAILURE and returns. No assertion may report `ok` in a run where nothing was
// scaffolded — `[].filter()` is `[]` and `path.join('', ...)` is a relative
// path into this repo, and both of those once produced a green report on a run
// that measured nothing.
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
import { promises as fs, existsSync, statSync, rmSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from 'child_process';
import { fileURLToPath } from 'url';
import { scaffoldProject, MODULE_OPTIONS, type ModuleOption } from '../../src/cli/new.js';

const { module, test } = QUnit;

const ACCEPTANCE = process.env.STONYX_ACCEPTANCE === '1';

/**
 * Mutation proof. NOT A FIX — nothing here touches this repo's source, and no
 * normal run applies it. It hand-patches the THROWAWAY generated project
 * inside the harness's own scratch directory so each assertion can be observed
 * going green, which is what makes a red run evidence rather than an artefact
 * of an assertion that could never pass.
 *
 * #90-#93 must make this harness green with CONTROL unset. If a story reaches
 * for this flag, it has misread its own acceptance criteria.
 *
 *   fixed    — apply the hand-fix; every assertion is expected to pass. The
 *              hand-fix includes #92's shape (an exact version plus
 *              pnpm.overrides), captured before the harness substitutes its
 *              own tarball.
 *   swallow  — apply the hand-fix AND drop the three files a consumer added
 *              during remediation (eslint.config.js, prettier.config.js,
 *              test/types/qunit-events.d.ts) into the generation directory
 *              with no `.gitignore` negation. Only the clone-parity assertion
 *              is expected to fail, demonstrating that it detects the whole
 *              `*.js` / `*.d.ts` swallow class rather than one instance.
 */
const CONTROL = process.env.STONYX_ACCEPTANCE_CONTROL ?? '';

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
 * `@stonyx/orm` is mandated by #89 ("selecting at least @stonyx/orm"). Read
 * from the scaffold's own `MODULE_OPTIONS` — not hand-copied — so the harness
 * generates what a real `stonyx new` generates and cannot drift when #91 adds
 * a directory or a generated file to the ORM option.
 */
const ORM_MODULE: ModuleOption | undefined = MODULE_OPTIONS.find(option => option.package === '@stonyx/orm');

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
  /**
   * Re-measured immediately before the sentinel is written. `siblingsPresent`
   * is a pre-BUILD snapshot; a `tsconfig` that stops excluding `test/` makes
   * `tsc` emit `test/config/environment.js` beside the `.ts`, the sentinel
   * lands in that gitignored artifact, and the central assertion reports #90
   * fixed while the trackedness assertions are still red on the same run.
   * #91 owns the build-output decision, so this must be measured at write time.
   */
  siblingsAtBoot: string[];
  /** What the SCAFFOLD emitted, captured before `pinTarball` overwrites it (#92). */
  scaffoldPin: { stonyx: string | null; overrides: Record<string, string> | null };
  /** Port handed to the generated app's `restServer` config for the serve smoke. */
  servePort: number;
  /** Non-null when a child died on EADDRINUSE — an environment fault, not an assertion result. */
  portConflict: string | null;
  install: CommandResult;
  build: CommandResult;
  serve: CommandResult;
  boot: { sentinel: string | null; bootError: string | null; raw: string };
  installedRealPath: string;
  cloneRealPath: string;
  serveChild: ChildProcess | null;
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
  siblingsAtBoot: [],
  scaffoldPin: { stonyx: null, overrides: null },
  servePort: 0,
  portConflict: null,
  install: { status: null, stdout: '', stderr: '' },
  build: { status: null, stdout: '', stderr: '' },
  serve: { status: null, stdout: '', stderr: '' },
  boot: { sentinel: null, bootError: null, raw: '' },
  installedRealPath: '',
  cloneRealPath: '',
  serveChild: null
};

/**
 * Variables a child needs to run `git`, `pnpm`, `npm`, `tsc` and `node`.
 * Everything else is dropped.
 *
 * This harness's premise is that it models a CLEAN CONSUMER environment, and
 * `{ ...process.env }` is the opposite of that. `serveSmoke` boots a real
 * `@stonyx/orm` app in production mode, and `@stonyx/orm`'s own
 * `config/environment.js` constructs live PG / MySQL / Timescale connection
 * blocks from ambient `*_HOST` / `*_PASSWORD`. That is inert today only
 * because serve dies on ERR_MODULE_NOT_FOUND first — which is exactly what
 * #91 and #92 remove. It is scrubbed now, while it is still inert.
 *
 * It also closes the log channel: child stdout/stderr is interpolated verbatim
 * into assertion messages that reach public CI logs.
 */
const ENV_ALLOWLIST = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL',
  'TMPDIR', 'TMP', 'TEMP',
  'LANG', 'LC_ALL', 'LC_CTYPE',
  'PNPM_HOME', 'COREPACK_HOME',
  'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'CI', 'GITHUB_ACTIONS', 'RUNNER_TEMP', 'RUNNER_TOOL_CACHE'
];

function childEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const key of ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }

  return { ...env, ...extra };
}

function run(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): CommandResult {
  const result: SpawnSyncReturns<string> = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: childEnv(env),
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

    // The `await import` sits INSIDE the try. Outside it, a renamed, moved or
    // re-signatured resolver — which is precisely the shape the accepted #88
    // ownership split takes — yields an empty `resolvableExtensions`, and the
    // demanded path then silently degrades to the literal 'js' this whole
    // derivation exists to avoid. The precondition asserts the array is
    // non-empty so that degradation can never pass unnoticed.
    const script = [
      `try {`,
      `  const { importConfig } = await import(${JSON.stringify(importConfigPath)});`,
      `  const value = await importConfig(${JSON.stringify(path.join(probeDir, 'cfg'))});`,
      `  process.stdout.write('OK:' + String(value));`,
      `} catch (error) {`,
      `  process.stdout.write('ERR:' + (error && error.message ? error.message : String(error)));`,
      `}`
    ].join('\n');

    const probe = run('node', ['--input-type=module', '-e', script], scratch);

    if (probe.stdout.startsWith(`OK:${ext.toUpperCase()}`)) resolved.push(ext);
  }

  rmSync(probeDir, { recursive: true, force: true });

  return resolved;
}

/**
 * Reserve a port the OS says is free, by binding it and letting go. Used
 * instead of a random draw from 20000-39999: roughly a third of that range
 * falls inside Linux's default `ip_local_port_range` (32768-60999), so a draw
 * can collide with an outbound socket the harness's own `pnpm install` is
 * holding. `@stonyx/rest-server` registers no `'error'` listener on its
 * server, so a bind failure kills the process outright.
 */
function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();

    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;

      probe.close(() => (port ? resolve(port) : reject(new Error('could not reserve a free TCP port'))));
    });
  });
}

/**
 * Give the generated app an explicit `restServer.port`.
 *
 * The previous mitigation — setting `REST_PORT` in the child environment — is
 * INERT against the package the clone actually installs. Published
 * `@stonyx/rest-server@0.2.0` opens its config with
 * `const { ..., REST_PORT, ... } = process;` — destructuring `process`, not
 * `process.env` — so `REST_PORT` is always `undefined` and the port is
 * unconditionally 2666. Verified against the published tarball and filed as
 * abofs/stonyx-rest-server#46. `REST_PORT=0` does not help for the same reason.
 *
 * `loadModules` merges the app's `config.restServer` OVER the module's own
 * defaults (`mergeObject(moduleConfig, userConfig)`), so app config is a
 * channel `0.2.0` does honour. The mutation is asserted to have applied —
 * a mitigation that silently failed to apply is how the inert one survived.
 */
async function injectServerPort(cloneDir: string, port: number): Promise<void> {
  const configPath = path.join(cloneDir, 'config', 'environment.ts');
  const source = await fs.readFile(configPath, 'utf8');
  const injected = source.replace(
    'export default config;',
    `Object.assign(config, { restServer: { port: ${port} } });\n\nexport default config;`
  );

  if (injected === source) {
    throw new Error(`could not inject restServer.port into ${configPath} — the scaffold's config template changed:\n${source}`);
  }

  await fs.writeFile(configPath, injected);
}

function serveSmoke(cloneDir: string, port: number): Promise<CommandResult> {
  return new Promise(resolve => {
    // The CLI binary directly, not `pnpm exec stonyx serve`. A pnpm wrapper
    // absorbs SIGTERM itself and reports status null / signal SIGTERM, so the
    // clean-shutdown assertion would be measuring pnpm rather than the app.
    //
    // The port arrives through the generated project's own config (see
    // injectServerPort). REST_PORT is still set because a FIXED rest-server
    // would honour it, but nothing here relies on it.
    const child = spawn(path.join(cloneDir, 'node_modules', '.bin', 'stonyx'), ['serve'], {
      cwd: cloneDir,
      env: childEnv({ REST_PORT: String(port) })
    });

    // Tracked on state so the signal handlers can kill it. A local `const` is
    // invisible to cleanup(), which is how an interrupted run left an orphaned
    // `stonyx serve` holding an inherited environment.
    state.serveChild = child;

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });

    // Give the app a boot window, then ask it to shut down cleanly.
    const terminate = setTimeout(() => child.kill('SIGTERM'), 10000);
    const giveUp = setTimeout(() => child.kill('SIGKILL'), 25000);

    // `close` waits for the stdio pipes as well as the process, so a
    // grandchild holding them would hang the promise past SIGKILL. `exit`
    // plus a settle timer bounds it.
    let settled = false;
    const settle = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(terminate);
      clearTimeout(giveUp);
      clearTimeout(bail);
      state.serveChild = null;
      resolve(result);
    };

    const bail = setTimeout(() => settle({ status: null, stdout, stderr: `${stderr}\nserve smoke did not settle within 40s` }), 40000);

    child.on('exit', status => settle({ status, stdout, stderr }));
    child.on('error', error => settle({ status: null, stdout, stderr: `${stderr}\n${error.message}` }));
  });
}

function cleanup(): void {
  if (state.serveChild) {
    try { state.serveChild.kill('SIGKILL'); } catch { /* already gone */ }
    state.serveChild = null;
  }

  if (!state.scratch) return;
  rmSync(state.scratch, { recursive: true, force: true });
  state.scratch = '';
}

// `after` covers pass and fail; `exit` covers a hard process exit. Neither
// fires for a signal-terminated process, and `concurrency.cancel-in-progress`
// makes cancellation the COMMON CI path — so Ctrl-C or a superseded job would
// otherwise orphan a `stonyx serve` child and leak a node_modules-sized
// scratch tree, one per interrupted run.
process.on('exit', cleanup);

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    cleanup();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

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

  /**
   * A setup failure is NOT an assertion result. Without this guard a run in
   * which the lifecycle threw still reported `ok` on the clone-parity
   * assertion (`[].filter()` is `[]`) and on the trap-B precondition
   * (`path.join('', ...)` is relative and resolved to THIS repo's own dist/,
   * comparing a file with itself). Both were reproduced by forcing `npm pack`
   * to fail. The harness's deliverable is a specific red set; a broken run
   * must be unmistakable, not a plausible-looking one.
   */
  function setupComplete(assert: Assert): boolean {
    if (state.setupError === null) return true;

    assert.ok(
      false,
      'HARNESS SETUP FAILURE — this is NOT an assertion result and says nothing about #90-#93. ' +
      `The lifecycle threw before this check could measure anything:\n${state.setupError}`
    );

    return false;
  }

  test('precondition: cleanup — scratch directories are created under mkdtemp, never a fixed path', function (assert) {
    if (!setupComplete(assert)) return;

    assert.ok(state.scratch.startsWith(os.tmpdir()), `scratch root is under the OS temp dir: ${state.scratch}`);
    assert.notStrictEqual(state.scratch, path.join(os.tmpdir(), 'stonyx-acceptance'), 'scratch root is not a predictable shared path');
    assert.ok(/stonyx-89-[^/]+$/.test(state.scratch), `scratch root carries an mkdtemp suffix: ${state.scratch}`);
  });

  test('precondition (trap B): tarball is packed from a dist/ built in this run', function (assert) {
    if (!setupComplete(assert)) return;

    // Guarded explicitly: `state.extractedPackage` is '' before it is assigned,
    // and `path.join('', 'dist', ...)` is a RELATIVE path that resolves to this
    // repo's own dist/ — which made every sub-assertion below compare a file
    // with itself and report green.
    assert.notStrictEqual(state.extractedPackage, '', 'the packed tarball was extracted (paths below are absolute)');
    assert.ok(path.isAbsolute(state.extractedPackage), `extracted package path is absolute: ${state.extractedPackage}`);

    if (!state.extractedPackage) return;

    assert.ok(
      state.distBuiltAt >= state.harnessStart,
      `dist/ was rebuilt during this run (built ${new Date(state.distBuiltAt).toISOString()}, run started ${new Date(state.harnessStart).toISOString()})`
    );

    const packed = path.join(state.extractedPackage, 'dist', 'util', 'import-config.js');
    const local = path.join(REPO_ROOT, 'dist', 'util', 'import-config.js');

    assert.ok(existsSync(packed), 'tarball contains dist/util/import-config.js');
    assert.notStrictEqual(packed, local, 'the packed and local copies are two different files, so the comparison below can fail');
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
    if (!setupComplete(assert)) return;

    // Same empty-string trap as above: `installedRealPath` is '' when nothing
    // was installed, and the byte-comparison then read this repo's own dist/.
    assert.notStrictEqual(state.installedRealPath, '', 'stonyx resolved inside the clone (paths below are absolute)');

    if (!state.installedRealPath) return;

    assert.ok(
      state.installedRealPath.startsWith(path.join(state.cloneRealPath, 'node_modules')),
      `installed stonyx resolves inside the clone's own node_modules, not the working tree: ${state.installedRealPath}`
    );
    assert.notOk(
      state.installedRealPath.startsWith(realRepoRoot()),
      `installed stonyx is not a link back into ${realRepoRoot()}`
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
    if (!setupComplete(assert)) return;

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
    if (!setupComplete(assert)) return;

    assert.strictEqual(
      state.siblingsPresent.length,
      1,
      `exactly one file exists at ${OVERRIDE_BASE}.* — found ${JSON.stringify(state.siblingsPresent)}. ` +
      'With a pair present, a `.js` specifier read from a `.ts` importer under tsx resolves the `.ts`, ' +
      'so the sentinel assertion could report success for a file plain node would never load.'
    );

    // Measured again AT SENTINEL-WRITE TIME. The check above is a pre-build
    // snapshot, and a tsconfig that stops excluding `test/` makes `tsc` emit
    // `test/config/environment.js` beside the `.ts` — the sentinel then lands
    // in a gitignored build artifact and the central assertion reports #90
    // fixed while the trackedness assertions are still red on the same run.
    // Reproduced. #91 owns the build-output decision, so this is live for it.
    assert.strictEqual(
      state.siblingsAtBoot.length,
      1,
      `exactly one file exists at ${OVERRIDE_BASE}.* AFTER the clone builds — found ${JSON.stringify(state.siblingsAtBoot)}. ` +
      'A pair here means `tsc` emitted into test/, and the sentinel would be written into a build artifact.'
    );
  });

  test('precondition: the harness instrumentation measured something — resolver probe, install and port', function (assert) {
    if (!setupComplete(assert)) return;

    // abofs/stonyx#90 AC6. This was a non-empty check: without it a renamed or
    // moved resolver yields [] and the demanded override path silently degrades
    // to the literal 'js', the hard-coded filename the whole derivation exists
    // to avoid. It is now the exact array, because that makes it a direct
    // executable test of the story's central platform premise — that Node
    // type-strips an app-root `.ts` imported by a `.js` module living inside
    // `node_modules`. The probe runs the PACKED `dist/util/import-config.js`
    // under plain `node` (never tsx), so if the premise is false this returns
    // ["js"] and #90 is disproved in one assertion. Order is preference order:
    // `.ts` first.
    assert.deepEqual(
      state.resolvableExtensions,
      ['ts', 'js'],
      `the packed build's importConfig resolves ["ts","js"], .ts first; got ${JSON.stringify(state.resolvableExtensions)}. ` +
      'An empty result means the probe could not call the resolver at all, and the demanded override path ' +
      'below is a hard-coded fallback rather than a measurement. ' +
      '["js"] alone means app-owned configs still resolve .js only (abofs/stonyx#90 not landed, or reverted).'
    );

    assert.strictEqual(state.install.status, 0, `pnpm install in the clone exited 0; got ${state.install.status}`);

    assert.ok(state.servePort > 0, `a free TCP port was reserved for the serve smoke; got ${state.servePort}`);
    assert.strictEqual(
      state.portConflict,
      null,
      `no child died on EADDRINUSE. This is an ENVIRONMENT fault, not an assertion result — re-run. Got: ${state.portConflict}`
    );
  });

  test('#90/#91 — the test-config override the framework demands is tracked by git', function (assert) {
    if (!setupComplete(assert)) return;

    assert.ok(
      state.lsFiles.includes(state.demandedOverridePath),
      `git ls-files in the clone contains ${state.demandedOverridePath} ` +
      `(the packed build resolves ${JSON.stringify(state.resolvableExtensions)}, so that is the path it demands). ` +
      `Present in the clone: ${JSON.stringify(state.siblingsPresent)}`
    );
  });

  test('#90/#91 — the test-config override the framework demands is not gitignored', function (assert) {
    if (!setupComplete(assert)) return;

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
    if (!setupComplete(assert)) return;

    assert.strictEqual(
      state.build.status,
      0,
      `pnpm build in the clone exits 0; got ${state.build.status}\n${state.build.stdout}\n${state.build.stderr}`
    );
  });

  test('#91 — the clone serves: stonyx serve reaches init and exits 0 on SIGTERM', function (assert) {
    if (!setupComplete(assert)) return;

    const combined = `${state.serve.stdout}\n${state.serve.stderr}`;

    assert.strictEqual(
      state.serve.status,
      0,
      `stonyx serve exits 0 after SIGTERM; got ${state.serve.status}\n${combined}`
    );

    // Gated on non-empty output: `notOk` on a regex over an empty string is
    // green for free, which is the same vacuity shape as the guards above.
    assert.ok(combined.trim().length > 0, 'the serve child produced output to match the warning against');
    assert.notOk(
      combined.trim().length > 0 && /Warning: both .* and .* exist/.test(combined),
      `no dual-extension entry-point warning on stderr\n${combined}`
    );
  });

  test('#90 — a sentinel present only in the test override wins over the primary config after a real boot', function (assert) {
    if (!setupComplete(assert)) return;

    assert.strictEqual(
      state.boot.sentinel,
      OVERRIDE_SENTINEL,
      `Stonyx.instance.config.${SENTINEL_KEY} is the override value after a real boot under NODE_ENV=test; ` +
      `got ${JSON.stringify(state.boot.sentinel)}. Boot error: ${state.boot.bootError ?? 'none'}`
    );
  });

  test('#92 — the scaffold pins an exact stonyx version and emits pnpm.overrides, not a dist-tag', function (assert) {
    if (!setupComplete(assert)) return;

    // Read from the capture taken BEFORE pinTarball overwrote these fields.
    // They are #92's entire deliverable, and the harness itself writes them.
    const pinned = state.scaffoldPin.stonyx;

    assert.ok(
      pinned !== null && /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(pinned),
      `the generated package.json pins devDependencies.stonyx to an exact version; got ${JSON.stringify(pinned)}. ` +
      'A dist-tag resolves to whatever is published at install time, so a consumer scaffolded today and one ' +
      'scaffolded tomorrow get different frameworks from the same command.'
    );
    assert.ok(
      state.scaffoldPin.overrides !== null && typeof state.scaffoldPin.overrides.stonyx === 'string',
      `the generated package.json emits pnpm.overrides.stonyx; got ${JSON.stringify(state.scaffoldPin.overrides)}`
    );
  });

  test('#90/#91 — no file committed in the generation directory is missing from the clone', function (assert) {
    if (!setupComplete(assert)) return;

    // `[].filter(...)` is `[]`, so without this guard the class-level guard for
    // the entire #88 defect reported `ok` on a run that never scaffolded
    // anything. Reproduced by forcing `npm pack` to fail.
    assert.ok(state.genFiles.length > 0, `the generation directory was measured and is non-empty; got ${state.genFiles.length} files`);
    assert.ok(state.cloneFiles.length > 0, `the clone was measured and is non-empty; got ${state.cloneFiles.length} files`);

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

/**
 * `REPO_ROOT` is derived from `import.meta.url` and is not realpath'd, while
 * everything it is compared against is — on a checkout reached through a
 * symlink the two live in different namespaces and the comparison can never
 * fire.
 */
function realRepoRoot(): string {
  try {
    return realpathSync(REPO_ROOT);
  } catch {
    return REPO_ROOT;
  }
}

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
  if (build.status !== 0) {
    throw new Error(
      `pnpm build in ${REPO_ROOT} failed. NOTE: this repo's dist/ was deleted above and has NOT been ` +
      `restored — run \`pnpm build\` before using this checkout.\n${build.stdout}\n${build.stderr}`
    );
  }

  state.distBuiltAt = statSync(path.join(REPO_ROOT, 'dist', 'util', 'import-config.js')).mtimeMs;

  const pack = run('npm', ['pack', '--json', '--pack-destination', state.scratch], REPO_ROOT);
  if (pack.status !== 0) throw new Error(`npm pack failed: ${pack.stdout}\n${pack.stderr}`);

  state.tarball = path.join(state.scratch, JSON.parse(pack.stdout)[0].filename);

  const extract = run('tar', ['-xzf', state.tarball, '-C', state.scratch], state.scratch);
  if (extract.status !== 0) throw new Error(`tar extract failed: ${extract.stderr}`);

  state.extractedPackage = path.join(state.scratch, 'package');
  state.resolvableExtensions = probeResolvableExtensions(state.scratch, state.extractedPackage);

  // 2. Generate a project, selecting @stonyx/orm.
  if (!ORM_MODULE) throw new Error('MODULE_OPTIONS no longer contains an @stonyx/orm option — the scaffold changed shape');

  await scaffoldProject(state.genDir, GENERATED_APP_NAME, [ORM_MODULE]);

  if (CONTROL) await applyControlPatch(state.genDir);

  // 3. Commit it, exactly as a consumer would before pushing.
  //    Every status is checked. `git clone` of an EMPTY repo exits 0 with only
  //    a warning, so an unchecked commit failure (a gpgsign config, a
  //    core.hooksPath pre-commit hook, an empty tree) produces a clone in
  //    which every scaffolded file is missing — which reads as a maximally
  //    successful detection of the #88 swallow rather than as a broken run.
  const gitEnv = { GIT_AUTHOR_NAME: 'harness', GIT_AUTHOR_EMAIL: 'harness@example.com', GIT_COMMITTER_NAME: 'harness', GIT_COMMITTER_EMAIL: 'harness@example.com' };

  mustSucceed(run('git', ['init', '-q', '.'], state.genDir), 'git init in the generation directory');
  mustSucceed(run('git', ['add', '-A'], state.genDir), 'git add -A in the generation directory');
  mustSucceed(run('git', ['commit', '-q', '-m', 'initial scaffold'], state.genDir, gitEnv), 'git commit in the generation directory');

  const committed = run('git', ['ls-files'], state.genDir).stdout.split('\n').filter(Boolean);
  if (committed.length === 0) throw new Error('git commit reported success but the generation directory has no tracked files');

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
  mustSucceed(state.install, 'pnpm install in the clone');

  state.installedRealPath = await fs.realpath(path.join(state.cloneDir, 'node_modules', 'stonyx')).catch(() => '');
  state.cloneRealPath = await fs.realpath(state.cloneDir);

  // 7. Build and serve BEFORE any sentinel injection, so an injected sentinel
  //    can never be the reason `tsc` fails. The port goes in first, because
  //    `stonyx serve` loads the BUILT `config/environment.js`.
  state.servePort = await reserveFreePort();
  await injectServerPort(state.cloneDir, state.servePort);

  state.build = run('pnpm', ['build'], state.cloneDir);

  // `outDir: '.'` leaves app.js beside app.ts, which makes resolveEntryPoint
  // warn on every serve. Deciding where build output goes is #91's call; the
  // control just removes it so the warning assertion can be seen going green.
  if (CONTROL) rmSync(path.join(state.cloneDir, 'app.js'), { force: true });

  state.serve = await serveSmoke(state.cloneDir, state.servePort);

  // 8. Re-measure the sibling pair HERE, not at step 5. The step-5 snapshot
  //    predates `pnpm build`; if the generated tsconfig ever stops excluding
  //    `test/`, `tsc` emits `test/config/environment.js` beside the `.ts` and
  //    the sentinel below lands in a gitignored build artifact. #91 owns that
  //    decision, so the pair must be observed at sentinel-write time.
  state.siblingsAtBoot = CANDIDATE_EXTENSIONS
    .map(ext => `${OVERRIDE_BASE}.${ext}`)
    .filter(candidate => existsSync(path.join(state.cloneDir, candidate)));

  // 9. Sentinel: distinct values in the primary config and in every override
  //    file that exists. No override file is CREATED — creating the one the
  //    resolver wants is the fix, and the fix belongs to #90.
  state.boot = await bootWithSentinels(state.cloneDir, state.servePort);

  // A bind failure is an ENVIRONMENT fault, not an assertion result. Recorded
  // separately so it cannot be read as the intended red on 9 or 10.
  const childOutput = `${state.serve.stdout}\n${state.serve.stderr}\n${state.boot.raw}\n${state.boot.bootError ?? ''}`;
  const conflict = childOutput.match(/EADDRINUSE[^\n]*/);

  if (conflict) state.portConflict = conflict[0];
}

/** Throw with the failing command's own output. Setup is not an assertion. */
function mustSucceed(result: CommandResult, what: string): void {
  if (result.status === 0) return;

  throw new Error(`${what} exited ${result.status}\n${result.stdout}\n${result.stderr}`);
}

/**
 * Overwrite the clone's `stonyx` dependency with the tarball packed in this
 * run — and CAPTURE what the scaffold emitted first. #92's deliverable is
 * exactly these two fields; without the capture the harness destroys the only
 * evidence of it, and a #92 that regressed to `'latest'` would be masked by
 * the harness's own pin.
 */
async function pinTarball(cloneDir: string, tarball: string): Promise<void> {
  const manifestPath = path.join(cloneDir, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const specifier = `file:${tarball}`;

  state.scaffoldPin = {
    stonyx: typeof manifest.devDependencies?.stonyx === 'string' ? manifest.devDependencies.stonyx : null,
    overrides: manifest.pnpm?.overrides ?? null
  };

  manifest.devDependencies.stonyx = specifier;
  manifest.pnpm = { ...(manifest.pnpm ?? {}), overrides: { ...(manifest.pnpm?.overrides ?? {}), stonyx: specifier } };

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function bootWithSentinels(cloneDir: string, port: number): Promise<HarnessState['boot']> {
  const primary = path.join(cloneDir, 'config', 'environment.ts');

  // `restServer.port` carries here too. This boot loads every module the
  // project selected, so without it the epic's CENTRAL assertion can go red on
  // a port collision that has nothing to do with config resolution.
  await fs.writeFile(primary, `const config = { ${SENTINEL_KEY}: '${PRIMARY_SENTINEL}', restServer: { port: ${port} } };\nexport default config;\n`);

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


/**
 * The hand-built fixed state. Deliberately minimal and deliberately dumb: it
 * is evidence, not a design. See the CONTROL comment above.
 */
async function applyControlPatch(genDir: string): Promise<void> {
  // The override at the extension the resolver demands, tracked past `*.js`.
  await fs.rename(path.join(genDir, `${OVERRIDE_BASE}.ts`), path.join(genDir, `${OVERRIDE_BASE}.js`));
  await fs.appendFile(
    path.join(genDir, '.gitignore'),
    '\n# Hand-authored test override — NOT build output. tsconfig excludes test/,\n' +
    '# so nothing ever emits this file. Without the negation above it vanishes on\n' +
    '# clone and the suite silently reverts to production configuration.\n' +
    `!${OVERRIDE_BASE}.js\n`
  );

  // TS2564 — the early `return App.instance` path leaves `ready` unassigned.
  const appPath = path.join(genDir, 'app.ts');
  await fs.writeFile(appPath, (await fs.readFile(appPath, 'utf8')).replace('ready: Promise<void>;', 'ready!: Promise<void>;'));

  // TS2724 — @stonyx/orm exports no `HasMany` type.
  const schemaPath = path.join(genDir, 'config', 'db-schema.ts');
  await fs.writeFile(schemaPath, (await fs.readFile(schemaPath, 'utf8')).replace(", type HasMany", ''));

  // TS2580 — the example config reads process.env with no @types/node, and
  // @stonyx/orm imports @stonyx/rest-server unconditionally.
  const manifestPath = path.join(genDir, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.devDependencies['@types/node'] = '^25.5.2';
  manifest.devDependencies['@stonyx/rest-server'] = 'latest';

  // #92's shape, hand-applied: an exact version plus pnpm.overrides instead of
  // the `latest` dist-tag the scaffold emits. Captured by `pinTarball` before
  // the harness substitutes its own tarball, so the assertion sees it.
  const exactVersion = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version;
  manifest.devDependencies.stonyx = exactVersion;
  manifest.pnpm = { ...(manifest.pnpm ?? {}), overrides: { ...(manifest.pnpm?.overrides ?? {}), stonyx: exactVersion } };

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  if (CONTROL !== 'swallow') return;

  // The three instances a consumer's remediation added, which `*.js` and
  // `*.d.ts` swallow with no negation. Present here, absent from the clone.
  writeFileSync(path.join(genDir, 'eslint.config.js'), 'export default [];\n');
  writeFileSync(path.join(genDir, 'prettier.config.js'), 'export default {};\n');
  mkdirSync(path.join(genDir, 'test', 'types'), { recursive: true });
  writeFileSync(path.join(genDir, 'test', 'types', 'qunit-events.d.ts'), 'export {};\n');
}
