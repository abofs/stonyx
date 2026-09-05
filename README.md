[![CI](https://github.com/abofs/stonyx/actions/workflows/ci.yml/badge.svg)](https://github.com/abofs/stonyx/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/stonyx.svg)](https://www.npmjs.com/package/stonyx)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

# Stonyx

**Stonyx** is a lightweight, modular framework for building modern Node.js applications. It provides a plug-and-play architecture, centralized color-coded logging, and seamless async module integration.

- Drop-in module system — no boilerplate
- Automatic async module loading and initialization
- Built-in CLI for scaffolding, bootstrapping, and testing

## Quick Start

```bash
npm install -g stonyx
stonyx new my-app
cd my-app
stonyx serve
```

The `new` command walks you through module selection and generates a ready-to-run project. From there, the CLI handles bootstrapping:

```bash
stonyx serve    # Bootstrap + run app.js
stonyx test     # Bootstrap + run tests
stonyx help     # Show all available commands
```

Stonyx reads `config/environment.ts` (preferred) or `config/environment.js`, initializes all `@stonyx/*` modules from your `devDependencies`, and runs your application.

## Documentation

| Section | Description |
|---------|-------------|
| [CLI](docs/cli.md) | Commands, aliases, and module commands |
| [Configuration](docs/configuration.md) | Environment config, module config, test overrides |
| [Modules](docs/modules.md) | Module architecture, async loading, official modules |
| [Logging](docs/logging.md) | Chronicle integration and custom log types |
| [Lifecycle](docs/lifecycle.md) | Startup and shutdown hooks |
| [Testing](docs/testing.md) | Test runner, helpers, and conventions |
| [Developing Modules](docs/developing-modules.md) | Guide for building custom Stonyx modules |
| [API Reference](docs/api.md) | Public exports and class documentation |

## Official Modules

| Module | Description |
|--------|-------------|
| [@stonyx/cron](https://github.com/abofs/stonyx-cron) | Lightweight async job scheduling |
| [@stonyx/discord](https://github.com/abofs/stonyx-discord) | Discord bot with command and event handler auto-discovery |
| [@stonyx/events](https://github.com/abofs/stonyx-events) | Pub/sub event system |
| [@stonyx/oauth](https://github.com/abofs/stonyx-oauth) | OAuth provider integration |
| [@stonyx/orm](https://github.com/abofs/stonyx-orm) | ORM with models, relationships, and serializers |
| [@stonyx/rest-server](https://github.com/abofs/stonyx-rest-server) | Dynamic REST server with auto-route registration |
| [@stonyx/sockets](https://github.com/abofs/stonyx-sockets) | WebSocket server and client |

## License

Apache 2.0
