import Qunit from 'qunit';
import { createFile, createDirectory, deleteDirectory, forEachFileImport } from '@stonyx/base/resource-handler';

const { module, test, hooks } = Qunit;
const testDir = './resource-handler-test';

module('[Unit] Resource Handler', function() {
  hooks.beforeEach(async function() {
    await createDirectory(testDir);
  });

  hooks.afterEach(async function() {
    await deleteDirectory(testDir);
  });

  test('JS Objects are correctly imported from given directory', async function(assert) {
    await Promise.all([
      createFile(testDir + '/test-file-a.js', `export default { data: 'test A'};`),
      createFile(testDir + '/test-file-b.js', `export default { data: 'test B'};`)
    ]);

    const exports = {};
    await forEachFileImport(testDir, (exported, { name }) => exports[name] = exported);

    assert.deepEqual(exports, {
      testFileA: { data: 'test A' },
      testFileB: { data: 'test B' }
    });
  });

  test('fullExport option provides full file export instead of default', async function(assert) {
    await createFile(testDir + '/testFullExport.js', `export default { data: 'fullExport'};`);

    let exportedContent;
    await forEachFileImport(testDir, exported => exportedContent = exported, { fullExport: true });

    assert.deepEqual(exportedContent, {
      default: { data: 'fullExport' }
    });
  });

  test('rawName option provides raw file name kebabCaseToCamelCase conversion', async function(assert) {
    await createFile(testDir + '/test-raw-name.js', `export default { data: 'rawName'};`);

    const exports = {};
    await forEachFileImport(testDir, (exported, { name }) => exports[name] = exported, { rawName: true });

    assert.deepEqual(exports, { 'test-raw-name': { data: 'rawName' } });
  });
});
