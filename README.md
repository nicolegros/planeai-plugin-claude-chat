# Claude Chat for PlaneAI

A PlaneAI provider plugin that runs Claude Code headlessly through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/typescript) and renders the session as a chat instead of a terminal.

A session created with the **Claude (chat)** provider is still a normal PlaneAI session.
It has its own worktree, branch, linked task, sidebar status and lifecycle.
Only its primary tab differs: PlaneAI mounts this plugin's chat UI where the terminal would be.

The chat renders markdown, tool calls with diffs, and permission prompts that can be allowed once, for the session, or denied with a reason.
When Claude asks questions, they take the message box's place, one at a time: pick with the arrow keys or a number, type another answer, or press Esc to skip; this works in every permission mode, including Bypass.
Each prompt starts a turn and stays pinned while you read its answer; once the turn ends, the steps Claude took fold behind a "Worked for 1m 4s · 3 commands, 2 edits" summary, each step reading as one line.
Edits and new files show their changed lines, commands their last lines of output, and agents their answer, without expanding the step.
Slash commands and skills run as in the terminal, with a `/` menu, and the chat's fonts and size are set in PlaneAI's preferences.

## Requirements

- A PlaneAI build with plugin providers (host API `planeai.plugin-host.v3`).
- Claude Code installed and on PlaneAI's `PATH` (`~/.local/bin`, Homebrew and `extra_path_dirs` are searched).
- Claude Code logged in: run `claude` once in a terminal.

The plugin never handles credentials.
It runs your installed `claude` through `pathToClaudeCodeExecutable`, so a headless session authenticates exactly like a terminal session: your subscription login, `ANTHROPIC_API_KEY`, or Bedrock/Vertex settings.

Anthropic's terms restrict third-party products from offering claude.ai login unless approved.
Confirm your use is covered before relying on subscription login for this plugin.

## Behavior

- **Same Claude Code as the terminal.** User, project and local settings load (`CLAUDE.md`, skills, MCP servers, hooks), with the `claude_code` system prompt preset.
- **Same session id.** The Claude session id starts as the PlaneAI session id, so PlaneAI restarts resume the conversation with `resume`.
  `/clear` moves Claude to a new session id, which the plugin records and resumes from then on.
  It also tags that conversation `planeai:<session id>` in Claude Code, so a reinstalled plugin finds it again.
- **Lazy start.** Starting or resuming a session spawns nothing; Claude starts on the first prompt or when the `/` menu first opens.
- **Status.** The plugin reports `busy`, `idle` and `needs_attention` to PlaneAI, which drives the sidebar and notifications.
  A pending permission prompt is `needs_attention`.
- **Auto-approve.** PlaneAI's auto-approve maps to `bypassPermissions`; otherwise Claude asks in the chat.
- **Controls.** The message box toggles the permission mode (Ask before acting, Accept edits, Plan only, and Bypass for auto-approve sessions), picks the model, shows context usage, and opens the conversation in a terminal.
  The model list is the one Claude Code last reported, remembered across sessions, so it is complete before a chat's Claude starts.
  Hovering the context meter also shows the claude.ai plan's 5-hour and weekly usage, as Claude Code last reported it, with when each window resets.
- **Slash commands.** Type `/` for a menu of Claude Code's commands and your skills, listed by Claude itself; Tab completes the highlighted one and Enter runs it.
  Commands run exactly as in the terminal: `/context` and `/usage` answer in the chat, and `/compact` and `/clear` mark the conversation where they happened.
  `/model <name>` with a model from the model list switches that list itself; other names go to Claude Code, which validates them and applies them to the running Claude process only, so the list and the next start keep the listed model.
  Terminal-only commands such as `/color` are left out once Claude Code has named them, which it does at the start of every turn; the plugin remembers them across sessions.
- **Fonts.** **Preferences → Plugins → Claude Chat** sets the chat's font, code font and size; open chats follow changes live.
  Empty fields keep PlaneAI's fonts, which also stand in for a font that is not installed.
- **Open in terminal.** Continues the conversation in Claude Code's own UI in a terminal tab of the same session, with the current mode and model.
  The chat stays read-only until that tab closes or Return to chat is selected.
  PlaneAI keeps track of the handoff, so quitting the app with the terminal open returns the session to the chat.
  A `/clear` typed in that terminal is not seen by the plugin, so returning to the chat resumes the conversation from before it.
- **Transcript.** Chat events are stored under the plugin data directory so the chat rebuilds after remounts and restarts.
  Destroying a session deletes them; archiving keeps them.
  When PlaneAI starts the plugin, it lists the sessions that still exist, and the plugin deletes the events of any other, such as one deleted while the plugin was not running.
  When they are gone, for example after the plugin is removed and installed again, the chat is rebuilt once from Claude Code's own transcript, without turn costs or permission prompts.

## Install

Download the archive for your platform from [Releases](https://github.com/nicolegros/planeai-plugin-claude-chat/releases), extract it, then in PlaneAI open **Preferences → Plugins → Install local package** and select the extracted `planeai-plugin-claude-chat` directory.
Enable it, then pick **Claude (chat)** as the provider when creating a session.

To update, install the new package the same way, over the installed one.
Do not remove the plugin first: removing it deletes its data, including every chat's history.

## Develop

Prerequisites: Node 22+, pnpm 10, and Bun 1.4.

```bash
pnpm install
make test            # tsc, svelte-check, vitest
make package         # stage dist/planeai-plugin-claude-chat for this platform
make verify-package  # handshake check against the staged binary
make conformance PLANEAI_CLI=/path/to/planeai-cli  # PlaneAI's offline provider contract checks
```

Install the staged `dist/planeai-plugin-claude-chat` directory into a PlaneAI dev build to try it.

### Layout

| Path | Role |
| --- | --- |
| `src/main.ts` | Sidecar entrypoint: JSON-RPC over stdio. |
| `src/rpc.ts` | Newline-framed JSON-RPC 2.0 peer with `$/cancelRequest` and the 64 KiB frame limit. |
| `src/plugin.ts` | Routes `provider.session.*`, `provider.sessions.reconcile` and the UI's `claude.*` calls to sessions. |
| `src/claude-session.ts` | One PlaneAI session driven by an Agent SDK streaming-input query. |
| `src/events.ts` | Translates SDK messages into the plugin's chat events. |
| `src/transcript.ts` | Per-session event log for reattach, the Claude session id `/clear` moved to and the reserved event seq; the plugin-wide terminal-only command names. |
| `src/appearance.ts` | Font settings validation and the CSS variables the chat reads. |
| `ui/` | Svelte 5 UIs, each built into one self-contained ESM bundle PlaneAI mounts: `ui/chat.js` for sessions and `ui/preferences.js` for the preferences pane. |

### Recorded streams

`tests/fixtures/*.jsonl` are real, sanitized Agent SDK message streams replayed through the translator and session tests.
Record a new one with your own `claude`:

```bash
bun scripts/record-stream.ts <fixture-name> "<prompt>" ["<next prompt>" ...]
```

Each further prompt is sent as its own turn, so slash commands can follow a first turn (`slash-commands.jsonl` records `/context`, `/compact` and `/clear`).
Review the fixture before committing it.

## Release

Conventional commits on `main` drive `auto` versioning.
The release workflow builds the sidecar with Bun on a native `macos-arm64`, `linux-x64` and `windows-x64` runner, injects the version into the manifest and the handshake, and runs the tests and `make verify-package` against each platform's own binary.
Only when every platform passes does it tag the commit and publish one archive per platform, each declaring only its own entrypoint, after approval in the `release` environment.
CI runs the same checks on the three platforms for every pull request.
