import type { CommandOption } from "./host";

/** Claude's slash commands, loaded the first time the user types `/`. */
export class CommandCatalog {
  list = $state<CommandOption[] | null>(null);
  error = $state<string | null>(null);
  private loading = false;
  private generation = 0;

  constructor(private readonly load: () => Promise<CommandOption[]>) {}

  /** Loads the list unless it is loaded or loading; a failed load is retried. */
  ensure(): void {
    if (this.list === null && !this.loading) void this.refresh();
  }

  /** Claude's commands changed; reload only if the menu was ever used. */
  invalidate(): void {
    if (this.list !== null || this.error !== null || this.loading) void this.refresh();
  }

  private async refresh(): Promise<void> {
    const generation = ++this.generation;
    this.loading = true;
    this.error = null;
    try {
      const list = await this.load();
      if (generation !== this.generation) return;
      this.list = list;
    } catch (error) {
      if (generation !== this.generation) return;
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }
}

/**
 * The command named or aliased exactly `query` first, so Enter runs what was typed; then
 * names starting with it, aliases starting with it, and names containing it, alphabetical within each.
 */
export function matchCommands(commands: CommandOption[], query: string): CommandOption[] {
  const needle = query.toLowerCase();
  const rank = (command: CommandOption): number => {
    const name = command.name.toLowerCase();
    const aliases = command.aliases.map((alias) => alias.toLowerCase());
    if (needle && (name === needle || aliases.includes(needle))) return 0;
    if (name.startsWith(needle)) return 1;
    if (aliases.some((alias) => alias.startsWith(needle))) return 2;
    return name.includes(needle) ? 3 : -1;
  };
  return commands
    .map((command) => ({ command, rank: rank(command) }))
    .filter(({ rank }) => rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.command.name.localeCompare(b.command.name))
    .map(({ command }) => command);
}
