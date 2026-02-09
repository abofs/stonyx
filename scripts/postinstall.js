import { copyFile, createDirectory } from '@stonyx/utils/file';

const projectDir = process.env.INIT_CWD;
const configDir = `${projectDir}/config`;
const envFile = 'environment.js';

createDirectory(configDir);

copyFile(`./config/environment copy.js`, `${configDir}/${envFile}`).then(result => {
  if (result) console.log(`Stonyx: ${envFile} has been successfully created. Please see README.md for more information.`);
});
