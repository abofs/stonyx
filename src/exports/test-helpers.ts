import Stonyx from 'stonyx';

interface TestHooks {
  before(fn: () => Promise<void>): void;
}

export function setupIntegrationTests(hooks: TestHooks): void {
  hooks.before(async function() {
    await Stonyx.ready;
    console.log('Stonyx ready');
  });
}
