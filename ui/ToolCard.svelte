<script lang="ts">
  import ToolInputView from "./ToolInputView.svelte";
  import type { ToolInput } from "./host";

  let { name, summary, input, result }: { name: string; summary: string; input?: ToolInput; result: { is_error: boolean; summary: string } | null } = $props();
  const state = $derived(result === null ? "running" : result.is_error ? "failed" : "done");
</script>

<details class="tool" data-state={state}>
  <summary>
    <span class="dot" aria-hidden="true"></span>
    <span class="name">{name}</span>
    <span class="summary">{summary}</span>
    <span class="state">{state === "running" ? "Running" : state === "failed" ? "Failed" : "Done"}</span>
  </summary>
  <div class="body">
    <ToolInputView {input} {summary} />
    {#if result?.summary}
      <pre class="output" class:failed={result.is_error}>{result.summary}</pre>
    {/if}
  </div>
</details>

<style>
  .tool { border: 1px solid var(--planeai-border); border-radius: var(--planeai-radius); background: var(--planeai-surface); }
  summary { display: flex; align-items: center; gap: var(--planeai-space-2); min-height: 32px; padding: 0 var(--planeai-space-3); cursor: pointer; list-style: none; font-size: 12.5px; }
  summary::-webkit-details-marker { display: none; }
  .dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--planeai-success); }
  [data-state="running"] .dot { background: var(--planeai-warning); animation: pulse 1.2s ease-in-out infinite; }
  [data-state="failed"] .dot { background: var(--planeai-danger); }
  .name { flex: none; font-weight: 600; }
  .summary { flex: 1; min-width: 0; overflow: hidden; color: var(--planeai-text-muted); font-family: var(--planeai-font-mono); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  .state { flex: none; color: var(--planeai-text-subtle); font-size: 11.5px; }
  .body { display: grid; gap: var(--planeai-space-2); padding: 0 var(--planeai-space-3) var(--planeai-space-3); }
  .output { margin: 0; max-height: 240px; overflow: auto; padding: var(--planeai-space-2) var(--planeai-space-3); font-family: var(--planeai-font-mono); font-size: 12px; white-space: pre-wrap; word-break: break-word; color: var(--planeai-text-muted); border-left: 2px solid var(--planeai-border-strong); }
  .output.failed { color: var(--planeai-danger); border-left-color: var(--planeai-danger); }
  @keyframes pulse { 50% { opacity: 0.35; } }
</style>
