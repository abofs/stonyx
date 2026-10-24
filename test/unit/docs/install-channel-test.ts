import QUnit from 'qunit';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const { module, test } = QUnit;

/*
 * abofs/stonyx#123: the untagged `stonyx` package resolves the `latest` dist-tag,
 * which is `0.2.2` — no `bin`, and a postinstall that fails with
 * ERR_MODULE_NOT_FOUND. Until a stable release is promoted, every install command
 * the docs hand a reader must name a channel that works (`@beta`) or an exact
 * version. This guards README.md and docs/**.md: fenced code blocks and inline
 * code spans alike, since a reader copies either.
 */

const repoRoot = process.cwd();

interface InstallSpec {
  file: string;
  line: number;
  command: string;
  spec: string;
}

// `npm i|install|add`, `pnpm add|i|install`, `yarn [global] add` take any number of
// package specs; `npx` and `pnpm dlx` take one (the first non-flag token), then args.
const MULTI_SPEC = /^(?:npm\s+(?:i|install|add)|pnpm\s+(?:add|i|install)|yarn\s+(?:global\s+)?add)(?=\s|$)(.*)$/;
const SINGLE_SPEC = /^(?:npx|pnpm\s+dlx)(?=\s|$)(.*)$/;
const STONYX_NAME = /^(stonyx|@stonyx\/[^@\s]+)(?:@(.*))?$/;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Package specs naming the core or a `@stonyx/*` module, from one shell line. */
function specsInCommandLine(rawLine: string): { command: string; spec: string }[] {
  const found: { command: string; spec: string }[] = [];
  const withoutComment = rawLine.replace(/(^|\s)#.*$/, '');
  for (const segment of withoutComment.split(/&&|\|\||;|\|/)) {
    const command = segment.trim().replace(/^\$\s+/, '');
    const multi = MULTI_SPEC.exec(command);
    const single = multi ? null : SINGLE_SPEC.exec(command);
    const rest = (multi ?? single)?.[1];
    if (rest === undefined) continue;
    let tokens = rest.trim().split(/\s+/).filter((t) => t && !t.startsWith('-'));
    if (single) tokens = tokens.slice(0, 1);
    for (const token of tokens) {
      if (STONYX_NAME.test(token)) found.push({ command, spec: token });
    }
  }
  return found;
}

/** Every stonyx install spec in a markdown document, with its line number. */
function extractInstallSpecs(markdown: string, file: string): InstallSpec[] {
  const specs: InstallSpec[] = [];
  let inFence = false;
  markdown.split(/\r?\n/).forEach((text, index) => {
    const line = index + 1;
    if (/^\s*(```|~~~)/.test(text)) {
      inFence = !inFence;
      return;
    }
    const candidates = inFence ? [text] : [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    for (const candidate of candidates) {
      for (const { command, spec } of specsInCommandLine(candidate)) {
        specs.push({ file, line, command, spec });
      }
    }
  });
  return specs;
}

/** True when the spec pins the `beta` channel or an exact version. */
function namesBetaOrExact(spec: string): boolean {
  const version = STONYX_NAME.exec(spec)?.[2];
  return version === 'beta' || (version !== undefined && EXACT_VERSION.test(version));
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith('.md') ? [path] : [];
  });
}

module('[Unit] Docs install channel (abofs/stonyx#123)', function() {
  test('the extractor flags untagged, latest and range specs and passes @beta and exact versions', function(assert) {
    const doc = [
      'Install it with `npm install -g stonyx` first.',
      '```bash',
      'npm install -g stonyx',
      'npm i stonyx@beta',
      'npm i stonyx@latest',
      'pnpm add stonyx@^0.2.3 @stonyx/orm',
      'pnpm add @stonyx/orm@0.3.2-beta.249',
      '$ yarn global add stonyx',
      'npm i -g --prefix /tmp/x stonyx@beta   # global, beta',
      'cd my-app && npx stonyx new my-app',
      'pnpm dlx stonyx@beta new my-app',
      'pnpm install',
      'stonyx serve    # Bootstrap + run app.ts',
      '```',
      'Then `cd <name> && pnpm install` resumes it.',
    ].join('\n');

    const verdicts = extractInstallSpecs(doc, 'fixture.md').map((s) => [s.line, s.spec, namesBetaOrExact(s.spec)]);

    assert.deepEqual(verdicts, [
      [1, 'stonyx', false],
      [3, 'stonyx', false],
      [4, 'stonyx@beta', true],
      [5, 'stonyx@latest', false],
      [6, 'stonyx@^0.2.3', false],
      [6, '@stonyx/orm', false],
      [7, '@stonyx/orm@0.3.2-beta.249', true],
      [8, 'stonyx', false],
      [9, 'stonyx@beta', true],
      [10, 'stonyx', false],
      [11, 'stonyx@beta', true],
    ], 'install commands in fences and inline code are found; bare `pnpm install` and non-install lines are not');
  });

  test('every stonyx install command in README.md and docs/ names @beta or an exact version', function(assert) {
    const files = [resolve(repoRoot, 'README.md'), ...markdownFiles(resolve(repoRoot, 'docs'))];
    const specs = files.flatMap((path) => extractInstallSpecs(readFileSync(path, 'utf8'), relative(repoRoot, path)));

    // Non-vacuity: the README Quick Start must still contain an install command,
    // or this check would pass on a docs tree that tells the reader nothing.
    assert.ok(specs.some((s) => s.file === 'README.md'), 'README.md contains at least one stonyx install command');

    const offenders = specs
      .filter((s) => !namesBetaOrExact(s.spec))
      .map((s) => `${s.file}:${s.line}: \`${s.command}\` installs \`${s.spec}\`, which resolves npm \`latest\``);
    assert.deepEqual(offenders, [], 'no install command resolves the untagged/latest channel');
  });
});
