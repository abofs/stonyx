import Chronicle from 'node-chronicle';

export default class Stonyx {
  static initialized = false

  constructor(config) {
    if (Stonyx.instance) return Stonyx.instance;
    Stonyx.instance = this;

    this.start(config);
  }

  async start(config) {
    if (!config) throw new Error('Stonyx requires full environment configuration on startup');

    this.config = config;
    this.chronicle = new Chronicle({ additionalLogs: { title: 'green', ...this.classColorConfigs }});
    Stonyx.initialized = true;
  }

  get classColorConfigs() {
    const colors = {};

    for (const [ className, config ] of Object.entries(this.config)) {
      if (!config || typeof config !== 'object') continue;
      if (!config.logColor) continue;

      const logMethod = config.logMethod || className;
      colors[logMethod] = config.logColor;
    }

    return colors;
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
