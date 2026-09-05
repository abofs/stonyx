/**
 * Validates and initializes stonyx modules
 * TODO: Refactor into a ModuleLoader class (good coding exercise)
 */
import { readFile } from '@stonyx/utils/file';
import { kebabCaseToCamelCase } from '@stonyx/utils/string';
import { mergeObject } from '@stonyx/utils/object';
import { importConfig, CONFIG_NOT_FOUND_PREFIX, CONFIG_NOT_LOADABLE_PREFIX } from './util/import-config.js';
import { findForeignCores, duplicateCoreMessage } from './util/duplicate-core.js';
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Why the old single catch had to go (abofs/stonyx#108, invariant I2).
 *
 * It spanned four distinct failure modes — config absent, config present and
 * declined, config throwing, entry point failing — and collapsed all four into
 * one fixed claim: `Stonyx modules with async loading must have a
 * config/environment.js file`. In the reproduction #108 was filed over, BOTH
 * facts in that sentence were false: the named file existed and imported
 * cleanly with nine keys, and the module named was not the module that threw.
 * The real error reached stderr only through a bare `console.error`, unlinked
 * from the thrown one, so a programmatic supervisor — or any log aggregator
 * that keeps the thrown message — lost the diagnosis entirely.
 *
 * `CONFIG_NOT_LOADABLE_PREFIX` was exported by abofs/stonyx#105 for exactly
 * this branch and had zero non-test importers in `src/` until now; #116
 * corrected the doc sentence and deliberately left the code here.
 *
 * NOT DONE, deliberately: #108's AC1 asks that a surviving config-file message
 * be "guarded by an `existsSync` on the module's own config/environment.js".
 * That guard could not fail. `importConfig` throws `CONFIG_NOT_FOUND_PREFIX`
 * only after `existsSync` has already returned false for every extension it
 * loads AND every extension it merely detects, so an `existsSync` re-check in
 * this branch is true by construction — a check that cannot red, which is the
 * defect family this cluster exists to remove. The branch is keyed on the
 * loader's own outcome instead, and the literal string is gone from `src/`
 * altogether, which is what the grep in that AC actually measures.
 *
 * SCOPE: this names which STEP failed and preserves the original verbatim. It
 * does not diagnose WHY a module's own config threw, and it cannot tell a
 * module that ships no config from one whose install was truncated.
 */
function describeConfigFailure(moduleName: string, configBasePath: string, error: unknown): Error {
  const message = messageOf(error);

  if (message.startsWith(CONFIG_NOT_FOUND_PREFIX)) {
    return new Error(
      `Stonyx module "${moduleName}" carries the "stonyx-async" keyword, which requires it to ship ` +
      `default configuration, and none is installed. Looked for ${configBasePath}.ts and ` +
      `${configBasePath}.js. This file ships inside "${moduleName}" — a missing one is a truncated ` +
      'or corrupted install of that module, not a mistake in this app\'s own config.',
      { cause: error }
    );
  }

  if (message.startsWith(CONFIG_NOT_LOADABLE_PREFIX)) {
    return new Error(
      `Stonyx module "${moduleName}" ships default configuration this Node runtime declined to ` +
      `load. ${message}`,
      { cause: error }
    );
  }

  return new Error(
    `Stonyx module "${moduleName}" failed while loading its default configuration from ` +
    `${configBasePath}: ${message}`,
    { cause: error }
  );
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

  // DISCOVERY, hoisted above the pre-flight.
  //
  // The pre-flight must check exactly what the loader loads, and no more.
  // `@stonyx/*` is a NAME test, not a membership test: a scoped devDependency
  // without the `stonyx-module` keyword is warned about and skipped below —
  // never imported, never configured, incapable of registering anything on any
  // singleton — and refusing to boot over its nested copy prescribed the MODULE
  // AUTHOR's remedy to a package that is not a module and has no such
  // obligation. #106 says the two predicates are different in as many words.
  // So the keyword gate runs first and the pre-flight sees only real modules.
  const discovered: { name: string; dir: string; package: Record<string, unknown>; keywords: string[] }[] = [];

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

    discovered.push({
      name: moduleName,
      dir: `${rootPath}/node_modules/${moduleName}`,
      package: modulePackage as Record<string, unknown>,
      keywords,
    });
  }

  // Pre-flight: invariant I1, "one core". Before ANY module entry point is
  // imported, because the point of the check is the module that would NOT
  // throw — it would load, initialise, and register its hooks on a second
  // singleton that nobody started. See src/util/duplicate-core.ts.
  //
  // It runs over every discovered module, SYNC AND ASYNC ALIKE. A sync module
  // is never imported by the loader, so its second core never announces itself
  // — which is exactly why the mechanism is a pre-flight and not a better
  // catch. The consequence is that `stonyx-async` no longer decides whether a
  // duplicate core is loud: both arms are refused here, by the same check,
  // before the keyword is ever read. docs/modules.md documents that.
  //
  // `console.warn` for the inconclusive probes: fail-open is the policy, but
  // "we could not check" must be distinguishable from "we checked and it is
  // fine". This is the file's existing idiom for a non-fatal loader advisory.
  const foreignCores = findForeignCores(
    discovered.map(({ name, dir }) => ({ name, dir })),
    undefined,
    message => console.warn(message)
  );

  if (foreignCores.length > 0) throw new Error(duplicateCoreMessage(foreignCores));

  // Standalone module configuration
  if (Array.isArray(rootPackage.keywords) && rootPackage.keywords.includes('stonyx-module')) {
    configureLog(chronicle, projectName, config as Record<string, unknown>);

    const entryPoint = typeof rootPackage.main === 'string' ? rootPackage.main : '';
    const { default: moduleClass } = await import(`${rootPath}/${entryPoint}`);
    initializeModule(projectName, moduleClass, modules, initPromises);
  }

  for (const { name: moduleName, package: modulePackage, keywords } of discovered) {
    if (!keywords.includes('stonyx-async')) {
      modulePromises[moduleName].resolve();
      continue;
    }

    // Load & Configure Async Modules
    const configBasePath = `${rootPath}/node_modules/${moduleName}/config/environment`;
    let moduleConfig: Record<string, unknown>;

    try {
      moduleConfig = await importConfig<Record<string, unknown>>(configBasePath);
    } catch (error) {
      throw describeConfigFailure(moduleName, configBasePath, error);
    }

    const module = kebabCaseToCamelCase(moduleName.split('/').pop() ?? moduleName);
    const userConfig = (config[module] as Record<string, unknown>) || {};
    const finalConfig = mergeObject(moduleConfig, userConfig);
    config[module] = finalConfig;

    // Configure module-specific logging
    configureLog(chronicle, module, finalConfig);

    const entryPath = `${rootPath}/node_modules/${moduleName}/${modulePackage.main as string}`;

    try {
      const { default: moduleClass } = await import(entryPath);
      initializeModule(moduleName, moduleClass, modules, initPromises);
    } catch (error) {
      throw new Error(
        `Stonyx module "${moduleName}" failed while importing its entry point ${entryPath}: ${messageOf(error)}`,
        { cause: error }
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
