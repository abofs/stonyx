/**
 * SCAFFOLD — abofs/stonyx#108, invariant I1 ("one core").
 *
 * Unit coverage for the pre-flight duplicate-core detector and its diagnostic.
 * The pre-flight exists because the CATCH is the wrong place to detect this: a
 * module that never touches `Stonyx.config` at load time does not throw at all
 * and silently registers its lifecycle hooks on a second singleton.
 */
import QUnit from 'qunit';

const { module, todo } = QUnit;

module('[Unit] duplicate-core detector', function() {
  todo('D1: reports nothing when a module resolves the running core', function(assert) {
    assert.ok(false, 'not implemented');
  });

  todo('D2: reports a module whose nested copy is a different physical package root', function(assert) {
    assert.ok(false, 'not implemented');
  });

  todo('D3: fails open — a module that cannot resolve stonyx at all is not reported', function(assert) {
    assert.ok(false, 'not implemented');
  });

  todo('D4: the diagnostic names the module, both absolute paths, both versions and the remedy', function(assert) {
    assert.ok(false, 'not implemented');
  });
});

module('[Unit] loadModules pre-flight', function() {
  todo('D5: throws before any module entry point is imported', function(assert) {
    assert.ok(false, 'not implemented');
  });

  todo('D6: reports every offending module, not just the first', function(assert) {
    assert.ok(false, 'not implemented');
  });
});
