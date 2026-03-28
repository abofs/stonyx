# Discord Conventions

Conventions for projects using `@stonyx/discord`.

## Command Files

- One class per file in the configured command directory (default: `discord-commands/`)
- Each file default-exports a class extending `Command` from `@stonyx/discord`
- Class must define a `data` property (a `SlashCommandBuilder` instance) and an `async execute(interaction)` method
- Class ordering: static properties → `data` → `execute()`
- Filenames use kebab-case; `forEachFileImport` converts to camelCase for internal registration
- Permission checks belong in the consuming application, not in the module

```js
import { Command } from '@stonyx/discord';
import { SlashCommandBuilder } from 'discord.js';

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
- Each file default-exports a class extending `EventHandler` from `@stonyx/discord`
- Class must set `static event` to a valid Discord.js event name (e.g., `'messageCreate'`, `'voiceStateUpdate'`)
- Class must implement a `handle(...args)` method matching the Discord.js event signature
- Class ordering: static properties → `handle()`

```js
import { EventHandler } from '@stonyx/discord';

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
