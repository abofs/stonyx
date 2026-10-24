# Release Process

This package follows the Stonyx shared release pipeline managed by [stonyx-workflows](https://github.com/abofs/stonyx-workflows).

See [stonyx-workflows/docs/release.md](https://github.com/abofs/stonyx-workflows/blob/main/docs/release.md) for the full release process, versioning scheme, and cascade publishing details.

**npm package:** `stonyx`

**Published contents:** `dist/`, `config/` (the two `environment copy` templates), `scripts/` (`postinstall.js` and the `postinstall-manifest.js` it imports) and `README.md`, per `files` in `package.json`; the packer adds `package.json` and `LICENSE.md`. `scripts/postinstall.js` runs on every consumer install, so keep it free of network and secret access.

**Pack-surface guard:** `test/unit/publish/pack-surface-test.ts` packs the tarball with `pnpm pack`, as the release job does, and fails if that tarball cannot install (abofs/stonyx#123). It reads `scripts` and `bin` from the tarball's own `package.json`, so `publishConfig` overrides count. It checks that:

- `scripts.postinstall` and `scripts/postinstall-manifest.js` are in the tarball, and so is every template the manifest names;
- the shipped postinstall, run for a JS consumer and for a TS consumer with only the tarball's `dependencies` resolvable, exits 0 and writes `config/environment.{js,ts}`;
- `preinstall` and `install` are not declared, so the postinstall is the only script a consumer install runs;
- `bin.stonyx` is in the tarball and starts with `#!/usr/bin/env node`;
- `prepack`, `prepare` and `postpack` are not declared. `pnpm pack` runs them in the release job, and the guard packs with scripts ignored, so a declared one would make the two tarballs differ.

The template names live in `scripts/postinstall-manifest.js`, which both the postinstall and the guard import: to rename a template, change the file and the manifest together.

Beyond this guard, the shared pipeline refuses a release artifact that has fewer than two entries, has no `package/package.json`, or contains a `.git` entry. Nothing else checks the tarball contents. After changing `files`, check the list by hand: `pnpm pack --pack-destination <tmp dir>`, then `tar -tzf <tmp dir>/stonyx-*.tgz`.
