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
    right: var(--chat-space-4);
    bottom: calc(100% + var(--chat-space-1));
    left: var(--chat-space-4);
    z-index: 1;
    max-height: min(calc(320 * var(--chat-unit)), 50vh);
    overflow-y: auto;
    padding: var(--chat-space-1);
    border: 1px solid var(--planeai-border);
    border-radius: var(--chat-radius);
    background: var(--planeai-surface);
    box-shadow: 0 calc(8 * var(--chat-unit)) calc(24 * var(--chat-unit)) color-mix(in srgb, var(--planeai-text) 14%, transparent);
  }
  .option { display: grid; gap: calc(2 * var(--chat-unit)); padding: calc(6 * var(--chat-unit)) var(--chat-space-2); border-radius: var(--chat-radius-inner); cursor: pointer; }
  .option[aria-selected="true"] { background: var(--planeai-accent-subtle); }
  .line { display: flex; align-items: baseline; gap: var(--chat-space-2); min-width: 0; }
  .name { flex: none; font-family: var(--chat-code-font); font-size: var(--chat-size-code); font-weight: 600; }
  .hint, .aliases { min-width: 0; overflow: hidden; color: var(--planeai-text-subtle); font-family: var(--chat-code-font); font-size: var(--chat-size-xs); text-overflow: ellipsis; white-space: nowrap; }
  .aliases { flex: none; margin-left: auto; font-family: var(--chat-font); }
  .description { overflow: hidden; color: var(--planeai-text-muted); font-size: var(--chat-size-sm); text-overflow: ellipsis; white-space: nowrap; }
  .state { padding: calc(6 * var(--chat-unit)) var(--chat-space-2); color: var(--planeai-text-subtle); font-size: var(--chat-size-sm); }
</style>
