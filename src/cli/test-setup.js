import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const cwd = process.cwd();
const require = createRequire(pathToFileURL(`${cwd}/package.json`));

const Stonyx = require('stonyx').default;
const config = require(`${cwd}/config/environment.js`).default;

new Stonyx(config, cwd);
