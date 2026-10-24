# Release Process

This package follows the Stonyx shared release pipeline managed by [stonyx-workflows](https://github.com/abofs/stonyx-workflows).

See [stonyx-workflows/docs/release.md](https://github.com/abofs/stonyx-workflows/blob/main/docs/release.md) for the full release process, versioning scheme, and cascade publishing details.

**npm package:** `stonyx`

**Published contents:** `dist/`, `config/` (the two `environment copy` templates), `scripts/` and `README.md`, per `files` in `package.json`; npm adds `package.json` and `LICENSE.md`. `scripts/postinstall.js` runs on every consumer install, so keep it free of network and secret access. No test guards the tarball contents: after changing `files`, check the list with `npm pack --dry-run`.
