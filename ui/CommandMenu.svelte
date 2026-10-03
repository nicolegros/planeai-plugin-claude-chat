<script lang="ts">
  import type { CommandOption } from "./host";

  let {
    id,
    matches,
    active,
    loading,
    error,
    onPick,
    onHover,
  }: { id: string; matches: CommandOption[]; active: number; loading: boolean; error: string | null; onPick: (command: CommandOption) => void; onHover: (index: number) => void } = $props();

  let list: HTMLElement | undefined = $state();

  $effect(() => {
    list?.querySelector(`[id="${id}-${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  });
</script>

<div class="commands" bind:this={list}>
  {#if error || loading || matches.length === 0}
    <p class="state" role="status">{error ?? (loading ? "Loading commands…" : "No matching commands")}</p>
  {:else}
    <div {id} role="listbox" aria-label="Slash commands">
      {#each matches as command, index (command.name)}
        <div
          class="option"
          id="{id}-{index}"
          role="option"
          tabindex="-1"
          aria-selected={index === active}
          onmousedown={(event) => {
            // Keep focus, and the caret, in the composer.
            event.preventDefault();
            onPick(command);
          }}
          onmousemove={() => index !== active && onHover(index)}
        >
          <span class="line">
            <span class="name">/{command.name}</span>
            {#if command.argument_hint}<span class="hint">{command.argument_hint}</span>{/if}
            {#if command.aliases.length > 0}<span class="aliases">{command.aliases.map((alias) => `/${alias}`).join(", ")}</span>{/if}
          </span>
          {#if command.description}<span class="description">{command.description}</span>{/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .commands {
    position: absolute;
    right: var(--planeai-space-4);
    bottom: calc(100% + var(--planeai-space-1));
    left: var(--planeai-space-4);
    z-index: 1;
    max-height: min(320px, 50vh);
    overflow-y: auto;
    padding: var(--planeai-space-1);
    border: 1px solid var(--planeai-border);
    border-radius: var(--planeai-radius);
    background: var(--planeai-surface);
    box-shadow: 0 8px 24px color-mix(in srgb, var(--planeai-text) 14%, transparent);
  }
  .option { display: grid; gap: 2px; padding: 6px var(--planeai-space-2); border-radius: calc(var(--planeai-radius) - 2px); cursor: pointer; }
  .option[aria-selected="true"] { background: var(--planeai-accent-subtle); }
  .line { display: flex; align-items: baseline; gap: var(--planeai-space-2); min-width: 0; }
  .name { flex: none; font-family: var(--planeai-font-mono); font-size: 12.5px; font-weight: 600; }
  .hint, .aliases { min-width: 0; overflow: hidden; color: var(--planeai-text-subtle); font-family: var(--planeai-font-mono); font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; }
  .aliases { flex: none; margin-left: auto; font-family: var(--planeai-font-sans); }
  .description { overflow: hidden; color: var(--planeai-text-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  .state { padding: 6px var(--planeai-space-2); color: var(--planeai-text-subtle); font-size: 12px; }
</style>
