import type { StoynxConfig } from 'stonyx';

// project configuration, override-able by listed environment variables
const {
  DEBUG,
  NODE_ENV,
} = process.env;

const environment = NODE_ENV ?? 'development';

const config: StoynxConfig = {
  environment,
  debug: DEBUG ?? environment === 'development',
};

export default config;
