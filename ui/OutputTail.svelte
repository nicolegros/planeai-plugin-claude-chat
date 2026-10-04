<script lang="ts">
  import { outputTail } from "./preview";

  let { output, failed }: { output: string; failed: boolean } = $props();
  const LINES = 3;
  let all = $state(false);
  const tail = $derived(outputTail(output, LINES, failed));
</script>

<div class="output-tail" class:failed>
  {#if all || tail.hidden === 0}
    <pre>{output.replace(/\n+$/, "")}</pre>
  {:else}
    <button type="button" class="earlier" onclick={() => (all = true)}>⋯ {tail.hidden} earlier {tail.hidden === 1 ? "line" : "lines"}</button>
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
