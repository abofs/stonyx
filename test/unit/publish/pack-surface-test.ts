import QUnit from 'qunit';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

const { module, test } = QUnit;

/*
 * abofs/stonyx#123, refinement validation assertion 4: the committed guard against
 * the rename trap.
 *
 * `scripts/postinstall.js` runs on every consumer install and copies a template from
 * the installed package's `config/` directory. If that template is not in the tarball,
 * `npm i stonyx` exits 1 with ENOENT for every consumer without an existing config.
 * Measured during #123 refinement: merging dev into main the naive way auto-applies
 * main's `environment copy.js` -> `environment.example.js` rename, and the resulting
 * tarball fails exactly that way. Nothing in the suite looked at the publish surface.
 *
 * The template names are read out of the postinstall source rather than restated
 * here, so renaming the template on one side only (the file, or the script) goes red.
 * Each extraction asserts it matched, so a refactor of the script cannot turn this
 * into a vacuous pass: it fails and says which pattern to update.
 */

const repoRoot = process.cwd();

function packedFiles(): Set<string> {
  // `--ignore-scripts`: list what `files` + npm's defaults put in the tarball without
  // running lifecycle hooks. `pnpm test` builds first, so `dist/` is present.
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const [result] = JSON.parse(out) as { files: { path: string }[] }[];
  return new Set(result.files.map((f) => f.path));
}

interface TemplateDerivation {
  sourceDir: string | null;
  extensions: string[];
  templatePattern: string | null;
}

/** The package-relative paths the postinstall can copy from, derived from its source. */
function deriveTemplatePaths(source: string): TemplateDerivation {
  // const extension = isTypeScriptConsumer ? 'ts' : 'js';
  const extMatch = /const\s+extension\s*=\s*[^?;]+\?\s*(['"])([^'"]+)\1\s*:\s*(['"])([^'"]+)\3/.exec(source);
  // const templateFile = `environment copy.${extension}`;
  const tplMatch = /const\s+templateFile\s*=\s*`([^`]*)`/.exec(source);
  // copyFile(`./config/${templateFile}`, ...)
  const dirMatch = /copyFile\(\s*`\.\/([^`$]*)\$\{templateFile\}`/.exec(source);
  return {
    sourceDir: dirMatch ? dirMatch[1] : null,
    extensions: extMatch ? [extMatch[2], extMatch[4]] : [],
    templatePattern: tplMatch ? tplMatch[1] : null,
  };
}

module('[Unit] Publish surface (npm pack --dry-run)', function(hooks) {
  let files: Set<string>;

  hooks.before(function() {
    files = packedFiles();
  });

  module('postinstall template', function() {
    test('every template the postinstall can copy is in the pack list', function(assert) {
      const source = readFileSync(join(repoRoot, 'scripts/postinstall.js'), 'utf8');
      const { sourceDir, extensions, templatePattern } = deriveTemplatePaths(source);

      assert.ok(templatePattern, 'found `const templateFile = `...`` in scripts/postinstall.js');
      assert.strictEqual(extensions.length, 2, 'found both branches of `const extension = ... ? ... : ...`');
      assert.ok(sourceDir !== null, 'found the `copyFile(`./<dir>/${templateFile}`` source path');
      if (!templatePattern || sourceDir === null) return;

      assert.ok(files.has('scripts/postinstall.js'), 'the postinstall itself ships');

      for (const extension of extensions) {
        const templateFile = templatePattern.replace(/\$\{extension\}/g, extension);
        assert.notOk(templateFile.includes('${'), `template name fully resolved: ${templateFile}`);
        const packPath = posix.normalize(`${sourceDir}${templateFile}`);
        assert.ok(
          files.has(packPath),
          `postinstall template \`${packPath}\` (extension \`${extension}\`) is in npm pack --dry-run`,
        );
      }
    });
  });

  module('bin', function() {
    test('bin.stonyx resolves to a file in the pack list', function(assert) {
      const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
        bin?: Record<string, string> | string;
      };
      const bin = typeof pkg.bin === 'string' ? { stonyx: pkg.bin } : pkg.bin ?? {};

      assert.ok(bin.stonyx, 'package.json declares bin.stonyx');
      if (!bin.stonyx) return;

      const packPath = posix.normalize(bin.stonyx);
      assert.ok(files.has(packPath), `bin.stonyx \`${packPath}\` is in npm pack --dry-run`);
      if (!files.has(packPath)) return;

      const firstLine = readFileSync(join(repoRoot, packPath), 'utf8').split('\n', 1)[0];
      assert.strictEqual(firstLine, '#!/usr/bin/env node', `${packPath} starts with a node shebang`);
    });
  });
});
