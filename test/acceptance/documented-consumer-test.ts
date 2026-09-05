/**
 * SCAFFOLD — abofs/stonyx#108 (PR-C, Sprint 93 install-and-boot cluster).
 *
 * Builds a consumer in the documented shape, in two arms that differ ONLY in
 * the fixtures' manifests, and boots it via `stonyx serve` in a real
 * subprocess. `peer` is the positive control: it must stay GREEN, before and
 * after the fix. A run where both arms are red is a broken harness, not a
 * caught bug.
 *
 * Every stub below is `QUnit.todo`, not `skip`: a todo MUST fail while
 * unimplemented and hard-fails the moment it starts passing, so this scaffold
 * cannot sit silently green.
 */
import QUnit from 'qunit';

const { module, todo } = QUnit;

module('[Acceptance] documented consumer — peer arm (positive control)', function() {
  todo('A1: exactly one distinct stonyx version on disk, equal to the declared version', function(assert) {
    assert.ok(false, 'not implemented');
  });

  todo('A2: stdout carries an init marker for EVERY selected module', function(assert) {
    assert.ok(false, 'not implemented');
  });

  todo('A3: the app boots (BOOT_OK) and the process exits 0', function(assert) {
    assert.ok(false, 'not implemented');
  });
});

module('[Acceptance] documented consumer — dup arm', function() {
  todo('A4: control — exactly two distinct stonyx versions on disk', function(assert) {
    assert.ok(false, 'not implemented');
  });

  todo('A5: boot fails with a diagnostic naming the module, both absolute paths and both versions', function(assert) {
    assert.ok(false, 'not implemented');
  });

  todo('A6: the diagnostic never mentions config/environment.js', function(assert) {
    assert.ok(false, 'not implemented');
  });
});
