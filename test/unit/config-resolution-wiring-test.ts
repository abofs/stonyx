import QUnit from 'qunit';

const { module, skip } = QUnit;

// abofs/stonyx#90 — WIRING coverage.
//
// A test of the resolver *function* proves nothing about which resolver each
// call site reaches. These are the two mis-routing directions the story exists
// to prevent:
//
//   AC5 goes red if `src/modules.ts:103` (module-owned) is routed to the
//       app-owned resolver — that is stonyx-orm#118 / the orm@0.3.1 P0 in full.
//   AC7 goes red if any of `src/cli/serve.ts:45`, `src/cli.ts:48` or
//       `src/cli/test-setup.ts:8` (all app-owned) is left on the module-owned
//       resolver.
//
// `src/main.ts:67` is the fourth app-owned call site; it is covered executably
// by AC8's sentinel in `test/acceptance/fresh-clone-scaffold-test.ts`.
//
// Not covered here, owned by other files:
//   AC6 — `state.resolvableExtensions` deep-equals ["ts","js"], strengthened in
//         place at `test/acceptance/fresh-clone-scaffold-test.ts:636-641`.
//   AC8 — the three `"issue": 90` entries deleted from
//         `test/acceptance/expected-failures.json`; exit condition is
//         `pnpm test:acceptance:ratchet` exiting 0.

module('[Unit] #90 wiring — module-owned call sites stay on the .js-only resolver', function() {
  // TODO(#90 AC5) — drive the real `loadModules()` against a fake rootPath whose
  //   `node_modules/@stonyx/<mod>/config/` contains BOTH `environment.ts` and
  //   `environment.js`, and assert the merged config carries the `.js` value.
  skip('AC5 loadModules resolves a module config through the .js-only path when both .ts and .js exist', function(assert) {
    assert.ok(false, 'TODO');
  });
});

module('[Unit] #90 wiring — app-owned CLI call sites reach the {ts,js} resolver', function() {
  // TODO(#90 AC7) — `src/cli/serve.ts:45`
  skip('AC7 serve resolves <cwd>/config/environment.ts when no .js sibling exists', function(assert) {
    assert.ok(false, 'TODO');
  });

  // TODO(#90 AC7) — `src/cli.ts:48` (the `bootstrap: true` module-command path)
  skip('AC7 cli bootstrap resolves <cwd>/config/environment.ts when no .js sibling exists', function(assert) {
    assert.ok(false, 'TODO');
  });

  // TODO(#90 AC7) — `src/cli/test-setup.ts:8`
  skip('AC7 test-setup resolves <cwd>/config/environment.ts when no .js sibling exists', function(assert) {
    assert.ok(false, 'TODO');
  });
});
