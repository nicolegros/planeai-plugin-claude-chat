import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import { clip, type CommandOption } from "./events";
import { page } from "./paging";
import type { TranscriptStore } from "./transcript";

/** One row per name: when Claude Code's own command shares a name with another, /name runs its own. */
function runnable(commands: SlashCommand[]): SlashCommand[] {
  const byName = new Map<string, SlashCommand>();
  for (const command of commands) {
    const seen = byName.get(command.name);
    if (!seen || (command.builtin && !seen.builtin)) byName.set(command.name, command);
  }
  return [...byName.values()];
}

/** The slash commands a session's menu lists, without terminal-only ones. */
export class SlashCommands {
  private commands: SlashCommand[] | null = null;
  private terminalOnly: Set<string>;
  private listed: CommandOption[] | null = null;

  constructor(private readonly store: TranscriptStore) {
    // Claude names terminal-only commands only when a turn starts; earlier sessions told us.
    this.terminalOnly = new Set(store.terminalCommands());
  }

  get loaded(): boolean {
    return this.commands !== null;
  }

  replace(commands: SlashCommand[]): void {
    this.commands = commands;
    this.listed = null;
  }

  /** Returns whether a menu showing the list should reload it. */
  setTerminalOnly(names: string[]): boolean {
    if (names.length === this.terminalOnly.size && names.every((name) => this.terminalOnly.has(name))) return false;
    this.terminalOnly = new Set(names);
    this.store.setTerminalCommands(names);
    this.listed = null;
    return this.loaded;
  }

  page(offset: number): { commands: CommandOption[]; more: boolean } {
    this.listed ??= runnable(this.commands ?? [])
      // `__`-prefixed commands are Claude Code internals, such as server-launched workflows.
      .filter((command) => !this.terminalOnly.has(command.name) && !command.name.startsWith("__"))
      .map(({ name, description, argumentHint, aliases }) => ({ name, description: clip(description, 240), argument_hint: clip(argumentHint, 120), aliases: aliases ?? [] }));
    const { items: commands, more } = page(this.listed, offset);
    return { commands, more };
  }
}
