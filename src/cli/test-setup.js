import { pathToFileURL } from 'url';

const cwd = process.cwd();

const { default: Stonyx } = await import('stonyx');
const { default: config } = await import(pathToFileURL(`${cwd}/config/environment.js`));

new Stonyx(config, cwd);
