<script lang="ts">
  import { diffRows } from "./preview";

  let { edits, cap = 12 }: { edits: { old_string: string; new_string: string }[]; cap?: number } = $props();
  let all = $state(false);
  const rows = $derived(diffRows(edits));
  const capped = $derived(!all && rows.length > cap);
</script>

<div class="diff-preview" class:capped>
  <pre>{#each capped ? rows.slice(0, cap) : rows as row, index (index)}{#if row.kind === "gap"}<span class="gap">{row.count ? `⋯ ${row.count} unchanged ${row.count === 1 ? "line" : "lines"}` : "⋯"}</span>{:else}<span class="line {row.kind}"><span class="marker">{row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " "}</span>{row.text || " "}</span>{/if}{/each}</pre>
  {#if rows.length > cap}
    <button type="button" class="more" onclick={() => (all = !all)}>{all ? "Show less" : `Show all ${rows.length} lines`}</button>
  {/if}
</div>

<style>
  .diff-preview { overflow: hidden; border: 1px solid var(--planeai-border); border-radius: calc(var(--chat-radius) - calc(2 * var(--chat-unit))); background: var(--planeai-surface); }
  pre { margin: 0; overflow-x: auto; padding: calc(4 * var(--chat-unit)) 0; font-family: var(--chat-code-font); font-size: var(--chat-size-xs); line-height: 1.55; }
  /* The last shown lines fade into the "Show all" button. */
  .capped pre { mask-image: linear-gradient(to bottom, black 70%, transparent); }
  .line { display: block; padding: 0 var(--chat-space-3) 0 var(--chat-space-2); white-space: pre; }
  .marker { display: inline-block; width: calc(14 * var(--chat-unit)); color: var(--planeai-text-subtle); user-select: none; }
  .add { background: color-mix(in srgb, var(--planeai-success) 13%, transparent); }
  .add .marker { color: var(--planeai-success); }
  .remove { background: color-mix(in srgb, var(--planeai-danger) 13%, transparent); }
  .remove .marker { color: var(--planeai-danger); }
  .gap { display: block; padding: 1px var(--chat-space-3); background: var(--planeai-canvas); color: var(--planeai-text-subtle); font-family: var(--chat-font); font-size: calc(var(--chat-size-xs) - 0.5px); }
  .more { display: block; width: 100%; min-height: calc(26 * var(--chat-unit)); padding: calc(2 * var(--chat-unit)); border: 0; border-top: 1px solid var(--planeai-border); border-radius: 0; background: var(--planeai-surface); color: var(--planeai-text-muted); font-size: var(--chat-size-xs); }
</style>
