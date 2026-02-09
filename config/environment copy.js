// project configuration, override-able by listed environment variables
const {
  DEBUG,
  NODE_ENV,
} = process.env;

const environment = NODE_ENV ?? 'development';

export default {
  environment,
  debug: DEBUG ?? environment === 'development',
}
