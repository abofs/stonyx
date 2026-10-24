# Discord Conventions

Conventions for projects using `@stonyx/discord`.

**Reference to copy:** the Quick Start in the `@stonyx/discord` README, which ships in the package (`node_modules/@stonyx/discord/README.md`). Its examples are complete files that import only from `@stonyx/discord` subpaths. The module's own samples, `test/sample/discord-commands/ping.js` and `test/sample/discord-events/log-message.js` in abofs/stonyx-discord, are written the same way, and its test suite loads both on every run. Online, with repository access: [ping.js](https://github.com/abofs/stonyx-discord/blob/dev/test/sample/discord-commands/ping.js), [log-message.js](https://github.com/abofs/stonyx-discord/blob/dev/test/sample/discord-events/log-message.js).

`Command`, `EventHandler` and `DiscordBot` are **default exports of their own subpaths**, not named exports of the `@stonyx/discord` root. `import { Command } from '@stonyx/discord'` does not resolve. `@stonyx/discord/base` re-exports these discord.js names: `SlashCommandBuilder`, `MessageFlags`, `PermissionFlagsBits`, `GatewayIntentBits`, `AttachmentBuilder`, `Client`, `Partials`, `REST`, `Routes`, `EmbedBuilder`, `ActionRowBuilder`, `ButtonBuilder` and `ButtonStyle` (the last four from `0.1.1-beta.145`). Import those from `/base`, not from `discord.js`. Any other discord.js name is not re-exported, so an app that uses one needs its own `discord.js` dependency.

## Command Files

- One class per file in the configured command directory (default: `discord-commands/`)
- Each file default-exports a class extending the default export of `@stonyx/discord/command`
- Class must define a `data` property (a `SlashCommandBuilder` instance) and an `async execute(interaction)` method
- Class ordering: static properties → `data` → `execute()`
- Filenames use kebab-case. The file name does not name the command: a command is registered under the name set on its `SlashCommandBuilder` (`data.name`), and that is the name users type
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

## How do I…

Each answer names the sample that shows it, in abofs/stonyx-discord (private: the links need repository access, and the samples are not in the npm package). `test/unit/sample-patterns-test.ts` in that repo runs them: the deploy script against a fake REST client, the router and `color.js` with fake interactions, and a booted bot that discovers the sample command and event directories.

**Register my slash commands with Discord?** Run a deploy script yourself whenever a command's `data` changes. It loads the command directory and PUTs each command's `data.toJSON()` to `Routes.applicationGuildCommands(applicationId, guildId)` with `REST` and `Routes` from `@stonyx/discord/base`. For a global deploy, use `Routes.applicationCommands(applicationId)`. Sample: [`scripts/deploy-commands.js`](https://github.com/abofs/stonyx-discord/blob/dev/test/sample/scripts/deploy-commands.js). It runs outside a booted app, so it follows [Standalone scripts are the exception](./index.md#standalone-scripts-are-the-exception).

**Handle buttons and autocomplete?** Write an event handler with `static event = 'interactionCreate'` that routes autocomplete by `interaction.commandName` and buttons by `customId` to methods on the command, and ignores chat-input interactions (the bot already runs those). Sample: [`discord-events/interaction-create.js`](https://github.com/abofs/stonyx-discord/blob/dev/test/sample/discord-events/interaction-create.js), with the `autocomplete()` and `button()` methods in [`discord-commands/color.js`](https://github.com/abofs/stonyx-discord/blob/dev/test/sample/discord-commands/color.js).

**Restrict who can press a button?** Check `interaction.user` or `interaction.memberPermissions` in the command's `button()` method. The interaction-create sample's header comment explains why: a command's permission settings apply to running the slash command, not to buttons on its replies or to autocomplete. Sample: [`discord-events/interaction-create.js`](https://github.com/abofs/stonyx-discord/blob/dev/test/sample/discord-events/interaction-create.js).

**Reply with an embed or a button row?** Import `EmbedBuilder`, `ActionRowBuilder`, `ButtonBuilder` and `ButtonStyle` from `@stonyx/discord/base`, not from `discord.js`. Sample: `buildEmbed()` and `execute()` in [`discord-commands/color.js`](https://github.com/abofs/stonyx-discord/blob/dev/test/sample/discord-commands/color.js).

**Import `Command`, `EventHandler` or `DiscordBot`?** Each is the default export of its own subpath: `@stonyx/discord/command`, `/event-handler`, `/bot`. The root exports only `Discord`. Samples: [`discord-commands/ping.js`](https://github.com/abofs/stonyx-discord/blob/dev/test/sample/discord-commands/ping.js) (`Command`) and [`discord-events/log-message.js`](https://github.com/abofs/stonyx-discord/blob/dev/test/sample/discord-events/log-message.js) (`EventHandler`). No sample imports `DiscordBot`; see the import in the discord README.

## Not a gap, by design

These are absent on purpose. Each has an intended pattern, so a report that one is missing is a usage question (see [Before you report a gap or bug](./index.md#before-you-report-a-gap-or-bug)).

- **The module never registers slash commands with Discord.** It loads command classes at boot and dispatches them, but registration is the app's deploy script (see the first How-do-I above). `src/` contains no `applicationCommands` or `applicationGuildCommands` call. Sample: [`scripts/deploy-commands.js`](https://github.com/abofs/stonyx-discord/blob/dev/test/sample/scripts/deploy-commands.js).
- **The bot dispatches only chat-input interactions.** Its own `interactionCreate` listener returns early for everything else. Buttons, autocomplete, select menus and modals belong to an app event handler. With the sample handler discovered, a slash command still runs exactly once (pinned by "wired into a booted bot" in `sample-patterns-test.ts`). Sample: [`discord-events/interaction-create.js`](https://github.com/abofs/stonyx-discord/blob/dev/test/sample/discord-events/interaction-create.js).
- **No named exports from the `@stonyx/discord` root.** `import { Command } from '@stonyx/discord'` does not resolve. Import from the subpaths (see [Exports](./framework-modules.md#stonyxdiscord)). Sample: [`discord-commands/ping.js`](https://github.com/abofs/stonyx-discord/blob/dev/test/sample/discord-commands/ping.js).
- **`@stonyx/discord/base` re-exports a fixed set of discord.js names**, listed at the top of this page. It is not all of discord.js: an app that needs another name (say `ModalBuilder`) declares its own `discord.js` dependency. Sample of the `/base` imports: [`discord-commands/color.js`](https://github.com/abofs/stonyx-discord/blob/dev/test/sample/discord-commands/color.js).
