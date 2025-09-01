/**
 * Validates and initializes stonyx modules
 * TODO: Refactor into a ModuleLoader class (good coding exercise) 
 */
import { readFile } from '@stonyx/utils/file';
import { kebabCaseToCamelCase } from '@stonyx/utils/string';

const modulePromises = {};

// Configure module-specific logging
function configureLog(chronicle, module, config) {
  const { logColor, logMethod, logTimestamp } = config;
  if (!logColor) return;
  
  chronicle.defineType(logMethod || module, logColor, { logTimestamp: !!logTimestamp });
}

function initializeModule(moduleName, moduleClass, modules, initPromises) {
  const moduleInstance = new moduleClass();
  
  modules.push(moduleInstance);

  if (!moduleInstance.init) return;
    
  initPromises.push((async () => {
    await moduleInstance.init();
    modulePromises[moduleName]?.resolve();
  })());
}

export default async function(config, rootPath, chronicle) {
  const modules = [];
  const initPromises = [];
  const rootPackage = await readFile(`${rootPath}/package.json`, { json: true });
  const { devDependencies:dependencies, name:projectName } = rootPackage;

  // Expose rootPath to public configuration
  config.rootPath = rootPath;

  const moduleDependencies = Object.keys(dependencies).filter(moduleName => moduleName.startsWith('@stonyx/'));

  // Setup module promises prior to initialization
  for (const moduleName of moduleDependencies) {
    const promise = {};
    modulePromises[moduleName] = promise;
    promise.ready = new Promise(resolve => promise.resolve = resolve);
  }

  // Standalone module configuration
  if (rootPackage.keywords?.includes('stonyx-module')) {
    configureLog(chronicle, projectName, config);

    const { main: entryPoint } = rootPackage; 
    const { default: moduleClass } = await import(`${rootPath}/${entryPoint}`);
    initializeModule(rootPackage.name, moduleClass, modules, initPromises);
  }

  for (const moduleName of moduleDependencies) {
    const modulePackage = await readFile(`${rootPath}/node_modules/${moduleName}/package.json`, { json: true, missingFileCallback: () => {
      console.warn(`Warning: Could not locate stonyx module: "${moduleName}". Module was not loaded`);
    }});

    if (!modulePackage) continue;

    const { keywords } = modulePackage;

    if (!keywords.includes('stonyx-module')) {
      console.warn(`Warning: Stonyx modules must contain the "stonyx-module" keyword. Module was not loaded`);
      continue;
    }
    
    if (!keywords.includes('stonyx-async')) {
      modulePromises[moduleName].resolve();
      continue;
    }

    try {
      // Load & Configure Async Modules
      const { default: moduleConfig } = await import(`${rootPath}/node_modules/${moduleName}/config/environment.js`);

      const module = kebabCaseToCamelCase(moduleName.split('/').pop());
      const userConfig = config[module] || {};
      const finalConfig = { ...moduleConfig, ...userConfig };
      
      config[module] = finalConfig;

      // Configure module-specific logging
      configureLog(chronicle, module, finalConfig);

      const { main: entryPoint } = modulePackage; 
      const { default: moduleClass } = await import(`${rootPath}/node_modules/${moduleName}/${entryPoint}`);
      initializeModule(moduleName, moduleClass, modules, initPromises);
    } catch (error) {
      console.error(error);
      throw new Error(`Stonyx modules with async loading must have a config/environment.js file with default configurations. Module "${moduleName}" failed to load.`);
    }
  }

  // Wait until all modules are initialized
  await Promise.all(initPromises);

  return modules;
}

export async function waitForModule(module) {
  module = `@stonyx/${module}`;
  const modulePromise = modulePromises[module];

  if (!modulePromise) throw new Error(`Could wait for module: ${module}. Module was not registered in project dependencies`);

  await modulePromises[module].ready;
}
