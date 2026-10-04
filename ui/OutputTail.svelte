<script lang="ts">
  import { plural } from "./format";
  import { outputTail } from "./preview";

  /** `lines`: the full output's line count, reported when `output` was clipped in the middle. */
  let { output, failed, lines }: { output: string; failed: boolean; lines?: number } = $props();
  let expanded = $state(false);
  const tail = $derived(outputTail(output, 3, failed, lines));
</script>

<div class="output-tail" class:failed>
  {#if expanded || tail.hidden === 0}
    <pre>{output.replace(/\n+$/, "")}</pre>
  {:else}
    <button type="button" class="earlier" onclick={() => (expanded = true)}>⋯ {plural(tail.hidden, "earlier line")}{#if tail.clippedFrom}{` · clipped from ${plural(tail.clippedFrom, "line")}`}{/if}</button>
    <pre>{tail.shown}</pre>
  {/if}
</div>

<style>
  .output-tail { padding-left: var(--chat-space-3); border-left: 2px solid var(--planeai-border-strong); }
  .output-tail.failed { border-left-color: var(--planeai-danger); }
  pre { margin: 0; max-height: calc(320 * var(--chat-unit)); overflow: auto; color: var(--planeai-text-muted); font-family: var(--chat-code-font); font-size: var(--chat-size-xs); line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
  .earlier { display: block; min-height: 0; padding: 0 0 calc(2 * var(--chat-unit)); border: 0; background: none; color: var(--planeai-text-subtle); font-size: var(--chat-size-2xs); }
  .earlier:hover:not(:disabled) { background: none; color: var(--planeai-text); }
</style>
