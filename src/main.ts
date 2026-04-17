/*
 * Copyright 2025 Stone Costa
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Chronicle from '@stonyx/logs';
import loadModules from './modules.js';
import { kebabCaseToCamelCase } from '@stonyx/utils/string';
import { mergeObject } from '@stonyx/utils/object';
import { importConfig } from './util/import-config.js';
import type { StoynxModule } from './lifecycle.js';
import type { StoynxConfig } from './modules.js';

export default class Stonyx {
  static initialized = false;
  static modulePromises: Record<string, unknown> = {};
  static instance: Stonyx;
  static ready: Promise<void>;

  config!: StoynxConfig;
  chronicle!: Chronicle;
  modules!: StoynxModule[];

  constructor(config: StoynxConfig, rootPath: string) {
    if (Stonyx.instance) return Stonyx.instance;

    Stonyx.instance = this;
    Stonyx.ready = this.start(config, rootPath);
  }

  async start(config: StoynxConfig, rootPath: string): Promise<void> {
    if (!config) throw new Error('Stonyx requires full environment configuration on startup');
    if (!rootPath) throw new Error('Stonyx requires root project\'s path on startup');

    // Transform config from stonyx-modules running as a standalone
    if (rootPath.includes('stonyx-')) {
      const dirName = rootPath.split('/').pop() ?? '';
      const moduleName = kebabCaseToCamelCase(dirName.replace('stonyx-', ''));
      config = { [moduleName]: config, ...((config as Record<string, unknown>).modules as Record<string, unknown> || {}) };
      delete (config as Record<string, unknown>).modules;
    }

    this.config = config;
    this.chronicle = new Chronicle({ additionalLogs: { title: 'green' }});

    Stonyx.initialized = true;

    // Auto-merge test environment overrides (after initialized flag, before modules load)
    // Uses in-place mutation to preserve existing references (e.g. stonyx/config export cache)
    if (process.env.NODE_ENV === 'test') {
      try {
        const testOverrides = await importConfig<Record<string, unknown>>(`${rootPath}/test/config/environment`);
        const merged = mergeObject(config as Record<string, unknown>, testOverrides);
        Object.assign(config, merged);
      } catch (err) {
        // Missing test override is non-fatal; re-throw import errors that aren't "not found"
        if (!(err instanceof Error) || !err.message.startsWith('Config not found:')) throw err;
      }
    }

    this.modules = await loadModules(config, rootPath, this.chronicle);
    this.configureUserLogs();
  }

  /**
   * Allows users to define their own log for any extra class via environment config
   */
  configureUserLogs(): void {
    const { chronicle } = this;

    for (const [ className, config ] of Object.entries(this.config)) {
      if (!config || typeof config !== 'object') continue;
      if (className in chronicle) continue;

      const { logColor, logMethod, logTimestamp } = config as Record<string, unknown>;

      if (!logColor) continue;

      chronicle.defineType((logMethod as string) || className, logColor as string, { logTimestamp: !!logTimestamp });
    }
  }

  static get log(): Chronicle {
    if (!Stonyx.initialized) throw new Error('Stonyx has not been initialized yet');

    return Stonyx.instance.chronicle;
  }

  static get config(): StoynxConfig {
    if (!Stonyx.initialized) throw new Error('Stonyx has not been initialized yet');

    return Stonyx.instance.config;
  }
}

export { waitForModule } from './modules.js';
