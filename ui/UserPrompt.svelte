<script lang="ts">
  import { slashCommand } from "./commands.svelte";

  let { text }: { text: string } = $props();
  const command = $derived(slashCommand(text));
  let element: HTMLElement | undefined = $state();
  let clamped = $state(false);
  let expanded = $state(false);

  // Only a prompt long enough to be cut off offers to expand.
  $effect(() => {
    if (!element || expanded) return;
    const measure = () => (clamped = element!.scrollHeight > element!.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  });
</script>

<header class="prompt">
  <div class="bubble"><p class="text" class:expanded bind:this={element}>{#if command}<code class="command">/{command.name}</code>{#if command.args}{" "}{command.args}{/if}{:else}{text}{/if}</p></div>
  {#if clamped || expanded}
    <button type="button" class="toggle" onclick={() => (expanded = !expanded)}>{expanded ? "Show less" : "Show more"}</button>
  {/if}
</header>

<style>
  .prompt { display: flex; flex-direction: column; align-items: flex-end; gap: var(--chat-space-1); padding: var(--chat-space-5) var(--chat-gutter) 0; }
  /* The padding is on a wrapper, so the clamp hides the fourth line instead of showing its top in the padding. */
  .bubble { max-width: 80%; padding: var(--chat-space-3); border-radius: calc(16 * var(--chat-unit)); background: var(--planeai-surface-raised); }
  .text { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; font-size: var(--chat-size-body); line-height: 1.6; font-weight: 400; white-space: pre-wrap; overflow-wrap: anywhere; }
  .text.expanded { display: block; max-height: 50vh; overflow-y: auto; }
  .command { padding: 1px calc(5 * var(--chat-unit)); border-radius: calc(4 * var(--chat-unit)); background: var(--planeai-surface-raised); font-family: var(--chat-code-font); font-size: var(--chat-size-code); }
  .toggle { flex: none; min-height: 0; padding: calc(2 * var(--chat-unit)) var(--chat-space-2); border-color: transparent; background: transparent; color: var(--planeai-text-subtle); font-size: var(--chat-size-xs); }
</style>
