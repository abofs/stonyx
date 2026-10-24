import QUnit from 'qunit';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

const { module, test } = QUnit;

/*
 * abofs/stonyx#123, refinement validation assertion 4: the committed guard against
 * a tarball that publishes but cannot be installed.
 *
 * `scripts/postinstall.js` runs on every consumer install. If a template it copies, a
 * package it imports, or the script itself is missing from what ships, `npm i stonyx`
 * exits 1 for every consumer without an existing config. `stonyx@0.2.2` shipped one of
 * these (`@stonyx/utils` in devDependencies), and the naive dev->main merge produces
 * another (main's `environment copy.js` -> `environment.example.js` rename).
 *
 * Nothing here parses the postinstall source. The guard packs the tarball the way the
 * release job does (`pnpm pack --pack-destination`), extracts it, reads `scripts` and
 * `bin` from the tarball's own package.json (so `publishConfig` is honoured), and:
 *   - imports the shipped `postinstall-manifest.js`, the data the postinstall itself
 *     copies from, and checks each template it names is in the tarball;
 *   - runs the shipped postinstall for a JS and a TS consumer, with only the tarball's
 *     `dependencies` resolvable, and checks it exits 0 and writes the config;
 *   - checks postinstall is the only install-time script, so running it covers install.
 */

const repoRoot = process.cwd();

// The lifecycle scripts `pnpm pack` runs (measured under pnpm 9.15.9 and 10.23.0).
const PACK_LIFECYCLE_SCRIPTS = ['prepack', 'prepare', 'postpack'];
// The scripts npm runs for a registry dependency on install, other than postinstall.
const INSTALL_LIFECYCLE_SCRIPTS = ['preinstall', 'install'];

interface PackageJson {
  name: string;
  version: string;
  bin?: Record<string, string> | string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
}

interface PostinstallManifest {
  templateDir: string;
  consumers: Record<'js' | 'ts', { template: string; destination: string }>;
}

interface Packed {
  workDir: string;
  pkgDir: string;
  files: Set<string>;
  pkg: PackageJson;
}

/** The pnpm running this suite when there is one, so the guard packs with the release job's pnpm. */
function pnpmCommand(): [string, string[]] {
  const execPath = process.env.npm_execpath;
  if (execPath && basename(execPath).startsWith('pnpm')) {
    return /\.c?js$/.test(execPath) ? [process.execPath, [execPath]] : [execPath, []];
  }
  return ['pnpm', []];
}

/**
 * Packs into a temp dir outside the repo and extracts the tarball to `<workDir>/node_modules/stonyx`.
 * Lifecycle scripts are not run (the "pack lifecycle" test asserts there are none to run).
 */
function pack(workDir: string): Packed {
  const outDir = join(workDir, 'out');
  const [cmd, prefix] = pnpmCommand();
  execFileSync(cmd, [...prefix, 'pack', '--config.ignore-scripts=true', '--pack-destination', outDir], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tarballs = readdirSync(outDir).filter((f) => f.endsWith('.tgz'));
  if (tarballs.length !== 1) throw new Error(`expected one tarball in ${outDir}, found ${tarballs.join(', ') || 'none'}`);
  const tarball = join(outDir, tarballs[0]);

  const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const outside = entries.filter((e) => !e.startsWith('package/'));
  if (outside.length) throw new Error(`tarball entries outside package/: ${outside.join(', ')}`);
  const files = new Set(entries.filter((e) => !e.endsWith('/')).map((e) => e.slice('package/'.length)));

  const pkgDir = join(workDir, 'node_modules', 'stonyx');
  mkdirSync(pkgDir, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', pkgDir, '--strip-components=1']);
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as PackageJson;

  // Make exactly the tarball's `dependencies` resolvable next to the extracted package,
  // linked to the copies installed for this repo. Nothing else is on the resolution path:
  // workDir is under the OS temp dir, not the repo.
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    const installed = join(repoRoot, 'node_modules', name);
    if (!existsSync(installed)) continue; // left unresolvable: the postinstall run reports it
    const link = join(workDir, 'node_modules', name);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(realpathSync(installed), link, 'dir');
  }
  return { workDir, pkgDir, files, pkg };
}

/**
 * The environment npm gives a dependency's postinstall on `npm i <tgz>` (measured under
 * npm 11.6.2): cwd and PWD are the installed package, INIT_CWD is the consumer root,
 * `npm_lifecycle_event` is `postinstall` and `npm_package_json` is the installed
 * package's package.json. Every `npm_*` / `pnpm_*` variable of the runner (`pnpm test`
 * sets `npm_package_json` to this repo's package.json and `npm_lifecycle_event` to
 * `test`) is dropped first, so a postinstall that reads them sees the tarball, not the repo.
 * Likewise every `node_modules/.bin` entry on PATH (`pnpm test` puts this repo's first, which
 * would let the postinstall exec a devDependency's bin) is replaced by the ones npm prepends
 * for the installed package.
 */
function installEnv(packed: Packed, consumerDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(npm|pnpm)_/i.test(key) && key !== 'NODE_PATH'),
  );
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  const systemPath = (env[pathKey] ?? '').split(delimiter).filter((dir) => dir && !/node_modules[\\/]\.bin[\\/]?$/.test(dir));
  env[pathKey] = [
    join(packed.pkgDir, 'node_modules', '.bin'),
    join(packed.workDir, 'node_modules', '.bin'),
    ...systemPath,
  ].join(delimiter);
  return Object.assign(env, {
    INIT_CWD: consumerDir,
    PWD: packed.pkgDir,
    npm_command: 'install',
    npm_config_global: 'false',
    npm_lifecycle_event: 'postinstall',
    npm_lifecycle_script: packed.pkg.scripts?.postinstall ?? '',
    npm_node_execpath: process.execPath,
    npm_package_json: join(packed.pkgDir, 'package.json'),
    npm_package_name: packed.pkg.name,
    npm_package_version: packed.pkg.version,
  });
}

/** `scripts.postinstall` from the tarball's package.json, as a package-relative path. */
function postinstallPath(pkg: PackageJson): string | null {
  const match = /^node\s+(\S+)$/.exec(pkg.scripts?.postinstall ?? '');
  return match ? posix.normalize(match[1]) : null;
}

module('[Unit] Publish surface (pnpm pack)', function(hooks) {
  let packed: Packed;

  hooks.before(function() {
    const workDir = mkdtempSync(join(tmpdir(), 'stonyx-pack-surface-'));
    try {
      packed = pack(workDir);
    } catch (error) {
      rmSync(workDir, { recursive: true, force: true });
      throw error;
    }
  });

  hooks.after(function() {
    if (packed) rmSync(packed.workDir, { recursive: true, force: true });
  });

  test('pack lifecycle: no script runs during `pnpm pack`, so this guard packs what the release job packs', function(assert) {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as PackageJson;
    for (const name of PACK_LIFECYCLE_SCRIPTS) {
      assert.notOk(
        pkg.scripts?.[name],
        `scripts.${name} is not declared (the release job's \`pnpm pack\` would run it; this guard packs with scripts ignored)`,
      );
    }
  });

  test('install lifecycle: postinstall is the only script npm runs when a consumer installs the tarball', function(assert) {
    for (const name of INSTALL_LIFECYCLE_SCRIPTS) {
      assert.notOk(
        packed.pkg.scripts?.[name],
        `tarball package.json does not declare scripts.${name} (npm runs it on install; this guard runs only postinstall)`,
      );
    }
  });

  module('postinstall', function() {
    test('scripts.postinstall and the manifest it imports are in the tarball', function(assert) {
      const script = postinstallPath(packed.pkg);
      assert.ok(script, `tarball package.json scripts.postinstall is \`node <path>\` (got ${JSON.stringify(packed.pkg.scripts?.postinstall)})`);
      if (!script) return;
      assert.ok(packed.files.has(script), `scripts.postinstall \`${script}\` is in the tarball`);
      const manifest = posix.join(posix.dirname(script), 'postinstall-manifest.js');
      assert.ok(packed.files.has(manifest), `\`${manifest}\` is in the tarball`);
    });

    test('every template in the shipped postinstall manifest is in the tarball', async function(assert) {
      const script = postinstallPath(packed.pkg);
      assert.ok(script, 'tarball package.json declares scripts.postinstall');
      if (!script) return;
      const manifestFile = join(packed.pkgDir, posix.dirname(script), 'postinstall-manifest.js');
      const { templateDir, consumers } = (await import(pathToFileURL(manifestFile).href)) as PostinstallManifest;

      const types = Object.keys(consumers).sort();
      assert.deepEqual(types, ['js', 'ts'], 'the manifest names a template for JS and TS consumers');
      for (const type of types as ('js' | 'ts')[]) {
        const packPath = posix.join(templateDir, consumers[type].template);
        assert.ok(packed.files.has(packPath), `${type} template \`${packPath}\` is in the tarball`);
      }
    });

    for (const type of ['js', 'ts'] as const) {
      test(`the shipped postinstall installs a ${type.toUpperCase()} consumer with only \`dependencies\` resolvable`, async function(assert) {
        const script = postinstallPath(packed.pkg);
        assert.ok(script, 'tarball package.json declares scripts.postinstall');
        if (!script) return;

        const consumerDir = join(packed.workDir, `consumer-${type}`);
        mkdirSync(consumerDir);
        if (type === 'ts') writeFileSync(join(consumerDir, 'tsconfig.json'), '{}\n');

        const run = spawnSync(process.execPath, [join(packed.pkgDir, script)], {
          cwd: packed.pkgDir,
          env: installEnv(packed, consumerDir),
          encoding: 'utf8',
        });
        assert.strictEqual(run.status, 0, `postinstall exits 0 (stderr: ${run.stderr.trim() || 'empty'})`);

        const manifestFile = join(packed.pkgDir, posix.dirname(script), 'postinstall-manifest.js');
        if (!existsSync(manifestFile)) return; // reported by the tests above
        const { templateDir, consumers } = (await import(pathToFileURL(manifestFile).href)) as PostinstallManifest;
        const { template, destination } = consumers[type];
        const written = join(consumerDir, 'config', destination);
        assert.ok(existsSync(written), `postinstall wrote config/${destination}`);
        if (!existsSync(written)) return;
        assert.strictEqual(
          readFileSync(written, 'utf8'),
          readFileSync(join(packed.pkgDir, templateDir, template), 'utf8'),
          `config/${destination} is a copy of the shipped \`${templateDir}/${template}\``,
        );
      });
    }
  });

  module('bin', function() {
    test('bin.stonyx in the tarball package.json resolves to a shipped node script', function(assert) {
      const { bin, name } = packed.pkg;
      const bins = typeof bin === 'string' ? { [name]: bin } : bin ?? {};

      assert.ok(bins.stonyx, 'tarball package.json declares bin.stonyx');
      if (!bins.stonyx) return;

      const packPath = posix.normalize(bins.stonyx);
      assert.ok(packed.files.has(packPath), `bin.stonyx \`${packPath}\` is in the tarball`);
      if (!packed.files.has(packPath)) return;

      const firstLine = readFileSync(join(packed.pkgDir, packPath), 'utf8').split('\n', 1)[0];
      assert.strictEqual(firstLine, '#!/usr/bin/env node', `${packPath} starts with a node shebang`);
    });
  });
});
