/**
 * Validates and initializes stonyx modules
 * TODO: Refactor into a ModuleLoader class (good coding exercise)
 */
import { readFile } from '@stonyx/utils/file';
import { kebabCaseToCamelCase } from '@stonyx/utils/string';
import { mergeObject } from '@stonyx/utils/object';
import { importModuleConfig } from './util/import-module-config.js';
import type { StoynxModule } from './lifecycle.js';
import type Chronicle from '@stonyx/logs';

interface DeferredPromise {
  ready: Promise<void>;
  resolve: () => void;
}

export type StoynxConfig = Record<string, Record<string, unknown> | unknown>;

const modulePromises: Record<string, DeferredPromise> = {};

// Configure module-specific logging
function configureLog(chronicle: Chronicle, module: string, config: Record<string, unknown>): void {
  const { logColor, logMethod, logTimestamp } = config;
  if (!logColor) return;

  chronicle.defineType((logMethod as string) || module, logColor as string, { logTimestamp: !!logTimestamp });
}

function initializeModule(
  moduleName: string,
  moduleClass: new () => StoynxModule,
  modules: StoynxModule[],
  initPromises: Promise<void>[]
): void {
  const moduleInstance = new moduleClass();

  modules.push(moduleInstance);

  if (!moduleInstance.init) return;

  initPromises.push((async () => {
    await moduleInstance.init!();
    modulePromises[moduleName]?.resolve();
  })());
}

export default async function loadModules(
  config: StoynxConfig,
  rootPath: string,
  chronicle: Chronicle
): Promise<StoynxModule[]> {
  const modules: StoynxModule[] = [];
  const initPromises: Promise<void>[] = [];
  const rootPackage = await readFile(`${rootPath}/package.json`, { json: true }) as Record<string, unknown>;
  const dependencies = (rootPackage.devDependencies || {}) as Record<string, string>;
  const projectName = typeof rootPackage.name === 'string' ? rootPackage.name : '';

  // Expose rootPath to public configuration
  config.rootPath = rootPath;

  const moduleDependencies = Object.keys(dependencies as Record<string, string>).filter(
    (moduleName: string) => moduleName.startsWith('@stonyx/')
  );

  // Setup module promises prior to initialization
  for (const moduleName of moduleDependencies) {
    const promise = {} as DeferredPromise;
    modulePromises[moduleName] = promise;
    promise.ready = new Promise<void>(resolve => promise.resolve = resolve);
  }

  // Standalone module configuration
  if (Array.isArray(rootPackage.keywords) && rootPackage.keywords.includes('stonyx-module')) {
    configureLog(chronicle, projectName, config as Record<string, unknown>);

    const entryPoint = typeof rootPackage.main === 'string' ? rootPackage.main : '';
    const { default: moduleClass } = await import(`${rootPath}/${entryPoint}`);
    initializeModule(projectName, moduleClass, modules, initPromises);
  }

  for (const moduleName of moduleDependencies) {
    const modulePackage = await readFile(`${rootPath}/node_modules/${moduleName}/package.json`, { json: true, missingFileCallback: (_filePath: string) => {
      console.warn(`Warning: Could not locate stonyx module: "${moduleName}". Module was not loaded`);
      return '';
    }});

    if (!modulePackage) continue;

    const keywords = Array.isArray(modulePackage.keywords) ? modulePackage.keywords as string[] : [];

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
      // MODULE-OWNED: `.js` only, always. Routing this to the app-owned
      // `importConfig` re-ships abofs/stonyx-orm#118 — Node refuses to
      // type-strip inside `node_modules`. See abofs/stonyx#90.
      const moduleConfig = await importModuleConfig<Record<string, unknown>>(`${rootPath}/node_modules/${moduleName}/config/environment`);

      const module = kebabCaseToCamelCase(moduleName.split('/').pop() ?? moduleName);
      const userConfig = (config[module] as Record<string, unknown>) || {};
      const finalConfig = mergeObject(moduleConfig, userConfig);
      config[module] = finalConfig;

      // Configure module-specific logging
      configureLog(chronicle, module, finalConfig);

      const entryPoint = modulePackage.main as string;
      const { default: moduleClass } = await import(`${rootPath}/node_modules/${moduleName}/${entryPoint}`);
      initializeModule(moduleName, moduleClass, modules, initPromises);
    } catch (error) {
      console.error(error);
      throw new Error(
        'Stonyx modules with async loading must ship a config/environment.js with default configurations. ' +
        'Module configs resolve as .js only — never .ts, because Node refuses to type-strip inside node_modules. ' +
        `Module "${moduleName}" failed to load.`
      );
    }
  }

  // Wait until all modules are initialized
  await Promise.all(initPromises);

  return modules;
}

export async function waitForModule(moduleName: string): Promise<void> {
  const fullName = `@stonyx/${moduleName}`;
  const modulePromise = modulePromises[fullName];

  if (!modulePromise) throw new Error(`Could wait for module: ${fullName}. Module was not registered in project dependencies`);

  await modulePromises[fullName].ready;
}
