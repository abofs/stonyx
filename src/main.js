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

import Chronicle from 'node-chronicle';
import loadModules from './modules.js';
import { kebabCaseToCamelCase } from '@stonyx/utils/string';

export default class Stonyx {
  static initialized = false
  static modulePromises = {};

  constructor(config, rootPath) {
    if (Stonyx.instance) return Stonyx.instance;

    Stonyx.instance = this;
    Stonyx.ready = this.start(config, rootPath);
  }

  async start(config, rootPath) {
    if (!config) throw new Error('Stonyx requires full environment configuration on startup');
    if (!rootPath) throw new Error('Stonyx requires root project\'s path on startup');

    // Transform config from stonyx-modules running as a standalone
    if (rootPath.includes('stonyx-')) {
      const moduleName = kebabCaseToCamelCase(rootPath.split('/').pop().replace('stonyx-', ''));
      config = { [moduleName]: config, ...(config.modules || {}) };
      delete config.modules;  
    }

    this.config = config;
    this.chronicle = new Chronicle({ additionalLogs: { title: 'green' }});

    Stonyx.initialized = true;

    this.modules = await loadModules(config, rootPath, this.chronicle);
    this.configureUserLogs();
  }

  /**
   * Allows users to define their own log for any extra class via environment config
   * { 
   *   myClass: {
   *     logColor: 'purple',
   *     logMethod: 'highlight'
   *     logTimestamp: true
   *   }
   & }
   */
  configureUserLogs() {
    const { chronicle } = this;

    for (const [ className, config ] of Object.entries(this.config)) {
      if (!config || typeof config !== 'object') continue;
      if (chronicle[className]) continue;

      const { logColor, logMethod, logTimestamp } = config;

      if (!logColor) continue;

      chronicle.defineType(logMethod || className, logColor, { logTimestamp: !!logTimestamp });
    }
  }
  
  static get log() {
    if (!Stonyx.initialized) throw new Error('Stonyx has not been initialized yet');

    return Stonyx.instance.chronicle;
  }

  static get config() {
    if (!Stonyx.initialized) throw new Error('Stonyx has not been initialized yet');

    return Stonyx.instance.config;
  }
}

export { waitForModule } from './modules.js';