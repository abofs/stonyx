import QUnit from 'qunit';
import { mkdtemp, mkdir, writeFile, rm, glob } from 'fs/promises';
import path from 'path';
import os from 'os';
import testCommand, { DEFAULT_TEST_GLOB } from '../../../src/cli/test.js';

const { module, test } = QUnit;

async function expand(cwd: string, pattern: string): Promise<string[]> {
  const matches: string[] = [];
  for await (const entry of glob(pattern, { cwd })) {
    matches.push(entry.split(path.sep).join('/'));
  }
  return matches.sort();
}

module('[Unit] CLI Test Command', function() {
  test('test command is a function', function(assert) {
    assert.equal(typeof testCommand, 'function', 'test command is a function');
  });

  module('default glob', function(hooks) {
    let fixtureDir: string;

    hooks.beforeEach(async function() {
      fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'stonyx-glob-'));
      await mkdir(path.join(fixtureDir, 'test', 'unit'), { recursive: true });
      await writeFile(path.join(fixtureDir, 'test', 'unit', 'foo-test.js'), '');
      await writeFile(path.join(fixtureDir, 'test', 'unit', 'bar-test.ts'), '');
      await writeFile(path.join(fixtureDir, 'test', 'unit', 'baz-test.cjs'), '');
      await writeFile(path.join(fixtureDir, 'test', 'unit', 'helper.js'), '');
    });

    hooks.afterEach(async function() {
      await rm(fixtureDir, { recursive: true, force: true });
    });

    test('matches .js test files', async function(assert) {
      const matches = await expand(fixtureDir, DEFAULT_TEST_GLOB);
      assert.ok(matches.includes('test/unit/foo-test.js'), 'matches .js');
    });

    test('matches .ts test files', async function(assert) {
      const matches = await expand(fixtureDir, DEFAULT_TEST_GLOB);
      assert.ok(matches.includes('test/unit/bar-test.ts'), 'matches .ts');
    });

    test('matches mixed .ts and .js in the same directory', async function(assert) {
      const matches = await expand(fixtureDir, DEFAULT_TEST_GLOB);
      assert.deepEqual(
        matches,
        ['test/unit/bar-test.ts', 'test/unit/foo-test.js'],
        'both .js and .ts are picked up; non-matching files are excluded'
      );
    });

    test('explicit glob argument overrides default', async function(assert) {
      const explicit = 'test/**/*-test.ts';
      const matches = await expand(fixtureDir, explicit);
      assert.deepEqual(matches, ['test/unit/bar-test.ts'], 'explicit glob narrows to .ts only');
    });
  });
});
