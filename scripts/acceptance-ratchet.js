#!/usr/bin/env node
/*
 * Expected-failures ratchet for the fresh-clone scaffold acceptance harness.
 *
 * The harness (abofs/stonyx#89) is RED BY DESIGN until #90, #91 and #92 land.
 * Running it bare in CI produces a permanently-red check, which is the highest-
 * leverage place for a vacuous check to hide: nobody re-examines a check that is
 * always red, and it cannot signal a NEW failure because it is already failing.
 *
 * This wrapper diffs the observed red set against
 * `test/acceptance/expected-failures.json` IN BOTH DIRECTIONS:
 *
 *   green today  — the known reds are the baseline, so nobody is trained to
 *                  ignore a red check;
 *   red on new   — an unlisted failure is a regression;
 *   red on fixed — an assertion that starts PASSING while still listed fails the
 *                  job, which mechanically forces each of #90-#92 to shrink the
 *                  baseline in its own PR.
 *
 * Usage: pnpm test:acceptance:ratchet
 */
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(REPO_ROOT, 'test', 'acceptance', 'expected-failures.json');

// The control flags hand-patch the generated project, so a controlled run says
// nothing about the baseline. Refuse rather than silently ratchet against it.
if (process.env.STONYX_ACCEPTANCE_CONTROL) {
  console.error(
    'STONYX_ACCEPTANCE_CONTROL is set. The ratchet compares an UNMODIFIED run against the\n' +
    'baseline; a control run hand-patches the generated project and would falsify it.\n' +
    'Run `pnpm test:acceptance` directly to exercise a control.'
  );
  process.exit(2);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const modulePrefix = `${baseline.module} > `;
const expected = new Map(baseline.expectedFailures.map(entry => [entry.name, entry.issue]));

const child = spawn(
  process.execPath,
  ['--import', 'tsx', 'node_modules/qunit/bin/qunit.js', 'test/acceptance/**/*-test.ts'],
  { cwd: REPO_ROOT, env: { ...process.env, STONYX_ACCEPTANCE: '1' }, stdio: ['inherit', 'pipe', 'inherit'] }
);

let tap = '';

child.stdout.on('data', chunk => {
  tap += String(chunk);
  process.stdout.write(chunk);
});

child.on('close', () => {
  const observed = new Map();

  for (const line of tap.split('\n')) {
    const match = /^(not ok|ok) \d+ (.*)$/.exec(line.trim());
    if (!match) continue;

    const name = match[2].startsWith(modulePrefix) ? match[2].slice(modulePrefix.length) : match[2];
    observed.set(name, match[1] === 'ok');
  }

  if (observed.size === 0) {
    fail(['The acceptance run produced no TAP assertions at all. This is a harness or setup failure, not a result.']);
  }

  const problems = [];

  for (const [name, passed] of observed) {
    if (!passed && !expected.has(name)) {
      problems.push(`NEW FAILURE (not in the baseline): ${name}\n    A regression, or an assertion that needs an owning issue before it is baselined.`);
    }

    if (passed && expected.has(name)) {
      problems.push(
        `NOW PASSING but still baselined (issue #${expected.get(name)}): ${name}\n` +
        '    Delete this entry from test/acceptance/expected-failures.json in the PR that fixed it.'
      );
    }
  }

  for (const name of expected.keys()) {
    if (!observed.has(name)) {
      problems.push(`BASELINED ASSERTION NOT FOUND: ${name}\n    It was renamed or removed. Update the baseline in the same PR.`);
    }
  }

  if (problems.length) fail(problems);

  const stillRed = [...expected.keys()].filter(name => observed.get(name) === false);

  console.log(`\n# acceptance ratchet: OK — ${observed.size} assertions, ${stillRed.length} expected failures, 0 unexpected.`);
  for (const name of stillRed) console.log(`#   expected red (#${expected.get(name)}): ${name}`);
  process.exit(0);
});

function fail(problems) {
  console.error('\n# acceptance ratchet: FAILED\n');
  for (const problem of problems) console.error(`  - ${problem}\n`);
  console.error('See test/acceptance/expected-failures.json and docs/testing.md.');
  process.exit(1);
}
