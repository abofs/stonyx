# Discord Conventions

Conventions for projects using `@stonyx/discord`.

**Reference samples:** copy [`test/sample/discord-commands/ping.js`](https://github.com/abofs/stonyx-discord/blob/dev/test/sample/discord-commands/ping.js) and [`test/sample/discord-events/log-message.js`](https://github.com/abofs/stonyx-discord/blob/dev/test/sample/discord-events/log-message.js) in abofs/stonyx-discord. The module's test suite loads both on every run.

`Command`, `EventHandler` and `DiscordBot` are **default exports of their own subpaths**, not named exports of the `@stonyx/discord` root. `import { Command } from '@stonyx/discord'` does not resolve. Builders and discord.js re-exports come from `@stonyx/discord/base`, so an app needs no direct `discord.js` dependency.

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
