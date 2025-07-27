// project configuration, override-able by listed environment variables
const {
  DEBUG,
  NODE_ENV,
} = process.env;

const isTest = typeof QUnit !== 'undefined';
const environment = isTest ? 'test' : (NODE_ENV ?? 'development');

export default {
  environment,
  debug: DEBUG ?? environment === 'development',
}
