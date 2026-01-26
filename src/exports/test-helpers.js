import Stonyx from 'stonyx';

export function setupIntegrationTests(hooks) {
  hooks.before(async function() {
    await Stonyx.ready;
    console.log('Stonyx ready');
  });
}
