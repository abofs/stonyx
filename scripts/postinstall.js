// Skip postinstall for global installations
const isGlobal = !process.env.INIT_CWD || process.env.npm_config_global === 'true';
if (isGlobal) process.exit(0);

const { existsSync } = await import('node:fs');
const { copyFile, createDirectory } = await import('@stonyx/utils/file');

const projectDir = process.env.INIT_CWD;
const configDir = `${projectDir}/config`;

// Detect consumer project type: presence of `tsconfig.json` in the consumer
// root signals a TypeScript project (see abofs/stonyx#62). TS consumers can't
// use the `.js` stub, so we ship both templates and copy the matching one.
const isTypeScriptConsumer = existsSync(`${projectDir}/tsconfig.json`);
const extension = isTypeScriptConsumer ? 'ts' : 'js';
const envFile = `environment.${extension}`;
const templateFile = `environment copy.${extension}`;

// Skip if the consumer ships its own `config/environment copy.{ts,js}` template —
// they manage their own bootstrap (see abofs/stonyx#54, extended in abofs/stonyx#62
// to honor either extension).
if (
  existsSync(`${configDir}/environment copy.ts`) ||
  existsSync(`${configDir}/environment copy.js`)
) process.exit(0);

// Don't overwrite an existing consumer config (either extension).
if (
  existsSync(`${configDir}/environment.ts`) ||
  existsSync(`${configDir}/environment.js`)
) process.exit(0);

createDirectory(configDir);

copyFile(`./config/${templateFile}`, `${configDir}/${envFile}`).then(result => {
  if (result) console.log(`Stonyx: ${envFile} has been successfully created. Please see README.md for more information.`);
});
