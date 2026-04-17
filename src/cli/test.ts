import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

export const DEFAULT_TEST_GLOB = 'test/**/*-test.{js,ts}';

export default async function test({ args }: { args: string[] }): Promise<void> {
  const cwd = process.cwd();
  const setupFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'test-setup.js');
  const setupFileUrl = pathToFileURL(setupFile).href;
  const qunitBin = path.resolve(cwd, 'node_modules/qunit/bin/qunit.js');

  const testArgs = args.length > 0 ? args : [DEFAULT_TEST_GLOB];

  const child = spawn(process.execPath, [
    '--import', setupFileUrl,
    qunitBin,
    ...testArgs
  ], {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' }
  });

  child.on('close', (code) => {
    process.exit(code ?? 1);
  });
}
