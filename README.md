# Claude Headless for PlaneAI

A PlaneAI provider plugin that runs Claude Code headlessly through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/typescript) and renders the session as a chat instead of a terminal.

A session created with the **Claude (chat)** provider is still a normal PlaneAI session.
It has its own worktree, branch, linked task, sidebar status and lifecycle.
Only its primary tab differs: PlaneAI mounts this plugin's chat UI where the terminal would be.

> **Status: v0, unreleased.**
> It needs a PlaneAI build with the unstable `planeai.plugin-host.v3` provider contract (ADR-0013).
> The chat renders markdown, tool calls with diffs, and permission prompts that can be allowed once, for the session, or denied with a reason.

## Requirements

- Claude Code installed and on PlaneAI's `PATH` (`~/.local/bin`, Homebrew and `extra_path_dirs` are searched).
- Claude Code logged in: run `claude` once in a terminal.

The plugin never handles credentials.
It runs your installed `claude` through `pathToClaudeCodeExecutable`, so a headless session authenticates exactly like a terminal session: your subscription login, `ANTHROPIC_API_KEY`, or Bedrock/Vertex settings.

Anthropic's terms restrict third-party products from offering claude.ai login unless approved.
Confirm your use is covered before relying on subscription login for this plugin.

## Behavior

- **Same Claude Code as the terminal.** User, project and local settings load (`CLAUDE.md`, skills, MCP servers, hooks), with the `claude_code` system prompt preset.
- **Same session id.** The Claude session id is the PlaneAI session id, so PlaneAI restarts resume the conversation with `resume`.
- **Lazy start.** Starting or resuming a session spawns nothing; Claude starts on the first prompt.
- **Status.** The plugin reports `busy`, `idle` and `needs_attention` to PlaneAI, which drives the sidebar and notifications.
  A pending permission prompt is `needs_attention`.
- **Auto-approve.** PlaneAI's auto-approve maps to `bypassPermissions`; otherwise Claude asks in the chat.
- **Controls.** The header switches model and permission mode (Ask before acting, Accept edits, Plan only, and Bypass for auto-approve sessions) and shows context usage.
- **Open in terminal.** Continues the conversation in Claude Code's own UI in a terminal tab of the same session, with the current mode and model.
  The chat stays read-only until that tab closes or Return to chat is selected.
- **Transcript.** Chat events are stored under the plugin data directory so the chat rebuilds after remounts and restarts.
  Destroying a session deletes them; archiving keeps them.

## Install

Download the archive for your platform from Releases, extract it, then in PlaneAI open **Preferences → Plugins → Install local package** and select the extracted `planeai-plugin-claude-headless` directory.
Enable it, then pick **Claude (chat)** as the provider when creating a session.

## Develop

Prerequisites: Node 22+, pnpm 10, and Bun 1.4.

```bash
pnpm install
make test            # tsc, svelte-check, vitest
make package         # stage dist/planeai-plugin-claude-headless for this platform
make verify-package  # handshake check against the staged binary
make conformance PLANEAI_CLI=/path/to/planeai-cli  # PlaneAI's offline provider contract checks
```

Install the staged `dist/planeai-plugin-claude-headless` directory into a PlaneAI dev build to try it.

### Layout

| Path | Role |
| --- | --- |
| `src/main.ts` | Sidecar entrypoint: JSON-RPC over stdio. |
| `src/rpc.ts` | Newline-framed JSON-RPC 2.0 peer with `$/cancelRequest` and the 64 KiB frame limit. |
| `src/plugin.ts` | Routes `provider.session.*` and the UI's `claude.*` calls to sessions. |
| `src/claude-session.ts` | One PlaneAI session driven by an Agent SDK streaming-input query. |
| `src/events.ts` | Translates SDK messages into the plugin's chat events. |
| `src/transcript.ts` | Per-session event log for reattach. |
| `ui/` | Svelte 5 chat UI, built into the single `ui/chat.js` ESM bundle PlaneAI mounts. |

### Recorded streams

`tests/fixtures/*.jsonl` are real, sanitized Agent SDK message streams replayed through the translator and session tests.
Record a new one with your own `claude`:

```bash
bun scripts/record-stream.ts <fixture-name> "<prompt>"
```

Review the fixture before committing it.

## Release

Conventional commits on `main` drive `auto` versioning.
The release workflow cross-compiles the sidecar with Bun for `macos-arm64`, `linux-x64` and `windows-x64`, and publishes one archive per platform, each declaring only its own entrypoint.
