# Discord Conventions

Conventions for projects using `@stonyx/discord`.

**Reference to copy:** the Quick Start in the `@stonyx/discord` README, which ships in the package (`node_modules/@stonyx/discord/README.md`). Its examples are complete files that import only from `@stonyx/discord` subpaths. The module's own samples, `test/sample/discord-commands/ping.js` and `test/sample/discord-events/log-message.js` in abofs/stonyx-discord, are written the same way, and its test suite loads both on every run. Online, with repository access: [ping.js](https://github.com/abofs/stonyx-discord/blob/dev/test/sample/discord-commands/ping.js), [log-message.js](https://github.com/abofs/stonyx-discord/blob/dev/test/sample/discord-events/log-message.js).

`Command`, `EventHandler` and `DiscordBot` are **default exports of their own subpaths**, not named exports of the `@stonyx/discord` root. `import { Command } from '@stonyx/discord'` does not resolve. `@stonyx/discord/base` re-exports these discord.js names: `SlashCommandBuilder`, `MessageFlags`, `PermissionFlagsBits`, `GatewayIntentBits`, `AttachmentBuilder`, `Client`, `Partials`, `REST` and `Routes`. Import those from `/base`, not from `discord.js`. Any other discord.js name (for example `EmbedBuilder` or `ButtonBuilder`) is not re-exported by the current beta, so an app that uses one needs its own `discord.js` dependency; abofs/stonyx-discord#44 extends `/base` with the builders.

## Command Files

- One class per file in the configured command directory (default: `discord-commands/`)
- Each file default-exports a class extending the default export of `@stonyx/discord/command`
- Class must define a `data` property (a `SlashCommandBuilder` instance) and an `async execute(interaction)` method
- Class ordering: static properties → `data` → `execute()`
- Filenames use kebab-case; `forEachFileImport` converts to camelCase for internal registration
- Permission checks belong in the consuming application, not in the module

```js
import { SlashCommandBuilder } from '@stonyx/discord/base';
import Command from '@stonyx/discord/command';

export default class PingCommand extends Command {
  data = new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with Pong!');

  async execute(interaction) {
    await interaction.reply('Pong!');
  }
}
```

## Event Handler Files

- One class per file in the configured event directory (default: `discord-events/`)
- Each file default-exports a class extending the default export of `@stonyx/discord/event-handler`
- Class must set `static event` to a valid Discord.js event name (e.g., `'messageCreate'`, `'voiceStateUpdate'`)
- Class must implement a `handle(...args)` method matching the Discord.js event signature
- Class ordering: static properties → `handle()`

```js
import EventHandler from '@stonyx/discord/event-handler';

export default class WelcomeHandler extends EventHandler {
  static event = 'guildMemberAdd';

  handle(member) {
    // Welcome new member
  }
}
```

## Configuration

- Config namespace: `config.discord`
- Environment variables prefixed with `DISCORD_`
- Logging: `log.discord()` — configured via `logColor: '#7289da'` and `logMethod: 'discord'`
- Intent auto-derivation: the module computes required gateway intents from discovered event handlers; use `additionalIntents` in config for edge cases

## Module Keywords

```json
"keywords": ["stonyx-async", "stonyx-module"]
```

`stonyx-async` indicates the module's `init()` is async and must be awaited by the framework.
