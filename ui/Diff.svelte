<script lang="ts">
  import { plural } from "./format";
  import { diffRows, type Edit } from "./preview";

  /** A preview shows changed lines with a little context, capped until shown in full; otherwise every line scrolls. */
  let { edits, preview = false }: { edits: Edit[]; preview?: boolean } = $props();

  const CAP = 12;
  let expanded = $state(false);
  const rows = $derived(diffRows(edits, preview ? 2 : Infinity));
  const more = $derived(preview ? rows.slice(CAP).filter((row) => row.kind !== "gap").length : 0);
  const capped = $derived(more > 0 && !expanded);
</script>

<div class="diff" class:preview class:capped>
  <pre>{#each capped ? rows.slice(0, CAP) : rows as row, index (index)}{#if row.kind === "gap"}<span class="gap">{row.count ? `⋯ ${plural(row.count, "unchanged line")}` : "⋯"}</span>{:else}<span class="line {row.kind}"><span class="marker">{row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " "}</span>{row.text || " "}</span>{/if}{/each}</pre>
  {#if more > 0}
    <button type="button" class="more" onclick={() => (expanded = !expanded)}>{expanded ? "Show less" : `Show ${plural(more, "more line")}`}</button>
  {/if}
</div>

<style>
  .diff { overflow: hidden; border: 1px solid var(--planeai-border); border-radius: var(--chat-radius-inner); background: var(--planeai-surface); }
  pre { margin: 0; max-height: calc(320 * var(--chat-unit)); overflow: auto; padding: var(--chat-space-1) 0; font-family: var(--chat-code-font); font-size: var(--chat-size-xs); line-height: 1.55; }
  .preview pre { max-height: none; overflow-y: hidden; }
  /* The last shown lines fade into the "Show more" button. */
  .capped pre { mask-image: linear-gradient(to bottom, black 70%, transparent); }
  .line { display: block; padding: 0 var(--chat-space-3) 0 var(--chat-space-2); white-space: pre; }
  .marker { display: inline-block; width: calc(14 * var(--chat-unit)); color: var(--planeai-text-subtle); user-select: none; }
  .add { background: color-mix(in srgb, var(--planeai-success) 13%, transparent); }
  .add .marker { color: var(--planeai-success); }
  .remove { background: color-mix(in srgb, var(--planeai-danger) 13%, transparent); }
  .remove .marker { color: var(--planeai-danger); }
  .gap { display: block; padding: 1px var(--chat-space-3); background: var(--planeai-canvas); color: var(--planeai-text-subtle); font-family: var(--chat-font); font-size: var(--chat-size-2xs); }
  .more { display: block; width: 100%; min-height: calc(26 * var(--chat-unit)); padding: calc(2 * var(--chat-unit)); border: 0; border-top: 1px solid var(--planeai-border); border-radius: 0; background: var(--planeai-surface); color: var(--planeai-text-muted); font-size: var(--chat-size-xs); }
</style>
