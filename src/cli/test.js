import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

export default async function test({ args }) {
  const cwd = process.cwd();
  const setupFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'test-setup.js');

  // Default to conventional test glob if no args provided
  const testArgs = args.length > 0 ? args : ['test/**/*-test.js'];

  const child = spawn('qunit', ['--require', setupFile, ...testArgs], {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' }
  });

  child.on('close', (code) => {
    process.exit(code);
  });
}
