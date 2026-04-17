// Skip postinstall for global installations
const isGlobal = !process.env.INIT_CWD || process.env.npm_config_global === 'true';
if (isGlobal) process.exit(0);

const { existsSync } = await import('node:fs');
const { copyFile, createDirectory } = await import('@stonyx/utils/file');

const projectDir = process.env.INIT_CWD;
const configDir = `${projectDir}/config`;
const envFile = 'environment.js';

// Skip if the consumer ships its own `config/environment copy.js` template —
// they manage their own bootstrap (see abofs/stonyx#54).
if (existsSync(`${configDir}/environment copy.js`)) process.exit(0);

createDirectory(configDir);

copyFile(`./config/environment copy.js`, `${configDir}/${envFile}`).then(result => {
  if (result) console.log(`Stonyx: ${envFile} has been successfully created. Please see README.md for more information.`);
});
