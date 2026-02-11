# Stonyx

**Stonyx** is a lightweight, modular framework for building modern Node.js applications. It provides a plug-and-play architecture, centralized color-coded logging, and seamless async module integration.

- 100% JavaScript (ES Modules)
- Drop-in module system — no boilerplate
- Automatic async module loading and initialization
- Built-in CLI for bootstrapping and testing

## Quick Start

```bash
npm install stonyx
```

The CLI handles everything — no manual `new Stonyx()` calls needed:

```bash
stonyx serve    # Bootstrap + run app.js
stonyx test     # Bootstrap + run tests
```

Stonyx reads `config/environment.js`, initializes all `@stonyx/*` modules from your `devDependencies`, and runs your application.

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
| [@stonyx/rest-server](https://github.com/abofs/stonyx-rest-server) | Dynamic REST server with auto-route registration |
| [@stonyx/orm](https://github.com/abofs/stonyx-orm) | ORM with models, relationships, and serializers |

## License

Apache 2.0
