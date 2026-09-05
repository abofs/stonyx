/**
 * Coverage for `src/modules.ts` — module auto-discovery (`loadModules`) and
 * `waitForModule`. See abofs/stonyx#109.
 *
 * SCAFFOLD: every row from the #109 specification is stubbed below with the
 * mutation it must die under. Stubs are filled in subsequent commits.
 *
 * Isolation constraint: `modulePromises` (modules.ts:19) is module-level state
 * with no reset and is not exported. Every test MUST use a module name unique
 * to that test, or a later test resolves an earlier test's deferred promise.
 */
import QUnit from 'qunit';

const { module, test } = QUnit;

module('[Unit] loadModules', function() {
  // T1 — discovery reads devDependencies. Must die under M1 (devDependencies -> dependencies).
  test.skip('TODO T1: devDependencies are discovered and instantiated', function(assert) { assert.ok(false); });

  // T2 — discovery ignores `dependencies` today (RED baseline #106 rule 3 flips). Must die under M1 inverted.
  test.skip('TODO T2: dependencies-only module is invisible', function(assert) { assert.ok(false); });

  // T3 — `@stonyx/` prefix filter. Must die under M2 ('@stonyx/' -> '@zzzzzz/').
  test.skip('TODO T3: only @stonyx/ scoped deps are registered', function(assert) { assert.ok(false); });

  // T4 — module `stonyx-module` keyword filter + F2 verbatim warning. Must die under M4.
  test.skip('TODO T4: module without stonyx-module keyword is skipped with a warning', function(assert) { assert.ok(false); });

  // T5 — `stonyx-async` early return. Must die under M5.
  test.skip('TODO T5: sync stonyx-module is registered but never instantiated', function(assert) { assert.ok(false); });

  // T6 — missingFileCallback on an uninstalled module. Must die under M6.
  test.skip('TODO T6: uninstalled module warns and does not throw', function(assert) { assert.ok(false); });

  // T7 — missingFileCallback fires on ENOENT only (B10). Must die under: pass callback for all errors.
  test.skip('TODO T7: malformed module package.json rejects, callback does not fire', function(assert) { assert.ok(false); });

  // T8 — missing `main` on the standalone/root path. Must die under M8.
  test.skip('TODO T8: root standalone module without main rejects ERR_MODULE_NOT_FOUND', function(assert) { assert.ok(false); });

  // T9 — missing `main` on the module path + F4 relabelling catch. Must die under: delete console.error at modules.ts:117.
  test.skip('TODO T9: async module without main relabels the error but logs the real one', function(assert) { assert.ok(false); });

  // T10 — root standalone path + F3 raw kebab name to configureLog. Must die under M3.
  test.skip('TODO T10: root stonyx-module keyword loads the root as a standalone module', function(assert) { assert.ok(false); });

  // T11 — registration loop and iteration loop consume the same list. Must die under M7 (.slice(1)).
  test.skip('TODO T11: every filtered dependency is pre-registered', function(assert) { assert.ok(false); });

  // T12 — config merge precedence. Must die under: swap mergeObject argument order at :107.
  test.skip('TODO T12: user config wins, module defaults fill, extras survive', function(assert) { assert.ok(false); });

  // T13 — HAZARD GUARD (F1), not a defect test. Must die under: resolve the promise before the continue at :93.
  test.skip('TODO T13: hazard guard - skipped module leaves waitForModule hanging forever', function(assert) { assert.ok(false); });
});

module('[Unit] waitForModule', function() {
  // T14 — unregistered name throws. Must die under: invert `if (!modulePromise)` at :132.
  test.skip('TODO T14: unregistered module name throws', function(assert) { assert.ok(false); });
});
