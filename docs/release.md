# Release Process

This package follows the Stonyx shared release pipeline managed by [stonyx-workflows](https://github.com/abofs/stonyx-workflows).

See [stonyx-workflows/docs/release.md](https://github.com/abofs/stonyx-workflows/blob/main/docs/release.md) for the full release process, versioning scheme, and cascade publishing details.

**npm package:** `stonyx`

**Published contents:** `dist/`, `config/` (the two `environment copy` templates), `scripts/` and `README.md`, per `files` in `package.json`; npm adds `package.json` and `LICENSE.md`. `scripts/postinstall.js` runs on every consumer install, so keep it free of network and secret access. `test/unit/publish/pack-surface-test.ts` runs `npm pack --dry-run` and fails if a template `scripts/postinstall.js` can copy, or the file `bin.stonyx` points at, is missing from the tarball (abofs/stonyx#123). It reads the template names out of the postinstall, so renaming a template means changing the script and the file together. Nothing else in the tarball is guarded: after changing `files`, still check the list by hand.
