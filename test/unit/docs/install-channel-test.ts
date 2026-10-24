import QUnit from 'qunit';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const { module, test } = QUnit;

/*
 * abofs/stonyx#123: the untagged `stonyx` package resolves the `latest` dist-tag,
 * which is `0.2.2` — no `bin`, and a postinstall that fails with
 * ERR_MODULE_NOT_FOUND. Until a stable release is promoted, every install command
 * the docs hand a reader must name the `@beta` channel. This guards README.md and
 * docs/**.md: fenced code blocks, inline code spans and `<code>` spans alike, since
 * a reader copies any of them.
 *
 * Why `@beta` only, and not "or an exact version": measured 2026-10-24 from the
 * registry packument, no stable `stonyx` release ships a `bin` (0.0.3–0.0.7, 0.1.0,
 * 0.2.0, 0.2.1, 0.2.2 — all of them), and the first version that does is
 * `0.2.3-beta.1`. An exact-version escape therefore admitted the broken release
 * itself (`stonyx@0.2.2`). Module stable lines are no safer: `@stonyx/cron@0.2.0` and
 * `@stonyx/rest-server@0.2.0` depend on core `^0.2.2`, which resolves `0.2.2`. A floor
 * per package would have to be kept in step with the registry; `@beta` needs none.
 * Revisit when abofs/stonyx#123 promotes a stable release.
 */

const repoRoot = process.cwd();

interface InstallSpec {
  file: string;
  line: number;
  command: string;
  spec: string;
}

// Leading flags are allowed between the binary and its subcommand (`npm -g install`).
const FLAGS = String.raw`(?:\s+-\S+)*\s+`;
// These take any number of package specs.
const MULTI_SPEC = new RegExp(String.raw`^(?:npm${FLAGS}(?:i|install|add)|pnpm${FLAGS}(?:add|i|install)|yarn${FLAGS}(?:global\s+)?add|bun${FLAGS}(?:add|i|install))(?=\s|$)(.*)$`);
// These take one package (the first non-flag token), then arguments for it.
const SINGLE_SPEC = new RegExp(String.raw`^(?:npx|bunx|pnpm${FLAGS}dlx|yarn${FLAGS}dlx|npm${FLAGS}(?:exec|x))(?=\s|$)(.*)$`);
const STONYX_NAME = /^(stonyx|@stonyx\/[^@\s]+)(?:@(.*))?$/;

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
    const words = rest.trim().split(/\s+/).map((t) => t.replace(/^(--package=)?(['"])(.*)\2$/, '$1$3'));
    let tokens = words.filter((t) => t && !t.startsWith('-'));
    const packageFlags = words.filter((t) => t.startsWith('--package=')).map((t) => t.slice('--package='.length));
    // With `--package=`, a single-spec command's positional is the bin to run, not a package.
    if (single) tokens = packageFlags.length ? packageFlags : tokens.slice(0, 1);
    else tokens.push(...packageFlags);
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
  let pending = '';
  let pendingLine = 0;
  markdown.split(/\r?\n/).forEach((text, index) => {
    const line = index + 1;
    if (/^\s*(```|~~~)/.test(text)) {
      inFence = !inFence;
      pending = '';
      return;
    }
    if (inFence && /\\$/.test(text)) {
      // Backslash continuation: join with the next line, report the first line.
      if (!pending) pendingLine = line;
      pending += text.replace(/\\$/, ' ');
      return;
    }
    const joined = pending + text;
    const reportedLine = pending ? pendingLine : line;
    pending = '';
    const candidates = inFence
      ? [joined]
      : [...joined.matchAll(/`([^`]+)`|<code>([^<]+)<\/code>/g)].map((m) => m[1] ?? m[2]);
    for (const candidate of candidates) {
      for (const { command, spec } of specsInCommandLine(candidate)) {
        specs.push({ file, line: reportedLine, command, spec });
      }
    }
  });
  return specs;
}

/** True when the spec names the `beta` dist-tag. See the header for why nothing else passes. */
function namesBeta(spec: string): boolean {
  return STONYX_NAME.exec(spec)?.[2] === 'beta';
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith('.md') ? [path] : [];
  });
}

module('[Unit] Docs install channel (abofs/stonyx#123)', function() {
  test('the extractor finds install commands in every shape, and only @beta passes', function(assert) {
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
      'npm install -g stonyx@0.2.2',
      'npm install -g stonyx@0.2.3-beta.101',
      'npm -g install stonyx',
      'pnpm -g add stonyx@beta',
      'npm exec stonyx new my-app',
      'npm exec --package=stonyx@beta -- stonyx new my-app',
      'npm x stonyx new my-app',
      'bunx stonyx new my-app',
      'bun add stonyx',
      'npm install -g "stonyx"',
      "npm install -g 'stonyx@beta'",
      'npm install -g \\',
      '  stonyx',
      'stonyx new my-app',
      '```',
      'Then `cd <name> && pnpm install` resumes it, or <code>npm i -g stonyx</code> it.',
    ].join('\n');

    const verdicts = extractInstallSpecs(doc, 'fixture.md').map((s) => [s.line, s.spec, namesBeta(s.spec)]);

    assert.deepEqual(verdicts, [
      [1, 'stonyx', false],
      [3, 'stonyx', false],
      [4, 'stonyx@beta', true],
      [5, 'stonyx@latest', false],
      [6, 'stonyx@^0.2.3', false],
      [6, '@stonyx/orm', false],
      [7, '@stonyx/orm@0.3.2-beta.249', false],
      [8, 'stonyx', false],
      [9, 'stonyx@beta', true],
      [10, 'stonyx', false],
      [11, 'stonyx@beta', true],
      // The broken `latest` release itself, pinned exactly: red.
      [14, 'stonyx@0.2.2', false],
      // A working exact pin is red too: the rule is `@beta` only (see header).
      [15, 'stonyx@0.2.3-beta.101', false],
      [16, 'stonyx', false],
      [17, 'stonyx@beta', true],
      [18, 'stonyx', false],
      [19, 'stonyx@beta', true],
      [20, 'stonyx', false],
      [21, 'stonyx', false],
      [22, 'stonyx', false],
      [23, 'stonyx', false],
      [24, 'stonyx@beta', true],
      [25, 'stonyx', false],
      [29, 'stonyx', false],
    ], 'install commands in fences, inline code and <code> are found, across flags-first, exec, bun, quotes and continuations; bare `pnpm install` and non-install lines are not');
  });

  test('every stonyx install command in README.md and docs/ names @beta', function(assert) {
    const files = [resolve(repoRoot, 'README.md'), ...markdownFiles(resolve(repoRoot, 'docs'))];
    const specs = files.flatMap((path) => extractInstallSpecs(readFileSync(path, 'utf8'), relative(repoRoot, path)));

    // Non-vacuity: the README Quick Start must still contain an install command,
    // or this check would pass on a docs tree that tells the reader nothing.
    assert.ok(specs.some((s) => s.file === 'README.md'), 'README.md contains at least one stonyx install command');

    const offenders = specs
      .filter((s) => !namesBeta(s.spec))
      .map((s) => `${s.file}:${s.line}: \`${s.command}\` installs \`${s.spec}\`, not the \`beta\` channel`);
    assert.deepEqual(offenders, [], 'every install command names @beta');
  });
});
