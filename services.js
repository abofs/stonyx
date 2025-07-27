import ENV from './config/environment.js';
import Chronicle from 'node-chronicle';

class Service {
  constructor() {
    if (Service.instance) return Service.instance;
    Service.instance = this;

    this.config = ENV;
    const externalLogConfigs = this.getClassColorConfigs();

    const log = new Chronicle({ additionalLogs: { title: 'green', ...externalLogConfigs }});

    this.log = log;
  }

  getClassColorConfigs() {
    const colors = {};

    for (const [ className, config ] of Object.entries(this.config)) {
      if (typeof config !== 'object') continue;
      if (!config.logColor) continue;

      colors[className] = config.logColor;
    }

    return colors;
  }
}

// export instantiated libraries to use as singleton services
const service = new Service();
const { log, config } = service;

export { log, config };