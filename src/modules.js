/**
 * Validates and initializes stonyx modules
 */

import { readFile } from '@stonyx/utils/file';

export default async (config, rootPath, chronicle) => {
  const modules = [];
  const initPromises = [];
  const rootPackage = await readFile(`${rootPath}/package.json`, { json: true });
  const { devDependencies:dependencies } = rootPackage;
  config.rootPath = rootPath;

  for (const moduleName of Object.keys(dependencies)) {
    if (!moduleName.startsWith('@stonyx/')) continue; // All official stonyx modules should be start with "@stonyx/"
     
    const modulePackage = await readFile(`${rootPath}/node_modules/${moduleName}/package.json`, { json: true, missingFileCallback: () => {
      console.warn(`Warning: Could not locate stonyx module: "${moduleName}". Module was not loaded`);
    }});

    if (!modulePackage) continue;

    const { keywords } = modulePackage;

    if (!keywords.includes('stonyx-module')) {
      console.warn(`Warning: Stonyx modules must contain the "stonyx-module" keyword. Module was not loaded`);
      continue;
    }

    if (!keywords.includes('stonyx-async')) continue;

    try {

      // Load & Configure Async Modules
      const { default: moduleConfig } = await import(`${rootPath}/node_modules/${moduleName}/config/environment.js`);

      const module = moduleName.split('/').pop();
      const userConfig = config[module] || {};
      const finalConfig = { ...moduleConfig, ...userConfig };
      config[module] = finalConfig;

      // Configure module-specific logging
      const { logColor, logMethod, logTimestamp } = finalConfig;
      if (logColor) chronicle.defineType(logMethod || module, logColor, { logTimestamp: !!logTimestamp });
  
      const { main: entryPoint } = modulePackage; 
      const { default: moduleClass } = await import(`${rootPath}/node_modules/${moduleName}/${entryPoint}`);
      const moduleInstance = new moduleClass();
      
      modules.push(moduleInstance);
      if (moduleInstance.init) initPromises.push(moduleInstance.init());

    } catch (error) {
      console.error(error);
      throw new Error(`Stonyx modules with async loading must have a config/environment.js file with default configurations.`);
    }
  }

  // Wait until all modules are initialized
  await Promise.all(initPromises);
}
