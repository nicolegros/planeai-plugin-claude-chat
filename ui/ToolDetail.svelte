<script lang="ts">
  import ToolInputView from "./ToolInputView.svelte";
  import type { ToolEntry } from "./tools";

  let { tool }: { tool: ToolEntry } = $props();
</script>

<div class="detail">
  {#if tool.input?.kind === "skill" && tool.input.args}<p class="caption">{tool.input.args}</p>{/if}
  <ToolInputView input={tool.input} summary={tool.summary} output={tool.result?.summary ?? ""} inline />
  {#if tool.result?.is_error && tool.input?.kind !== "bash"}<p class="caption failed">The tool reported an error.</p>{/if}
</div>

<style>
  .detail { display: grid; gap: var(--chat-space-2); min-width: 0; }
  .caption { color: var(--planeai-text-muted); font-size: var(--chat-size-sm); }
  .failed { color: var(--planeai-danger); }
</style>
