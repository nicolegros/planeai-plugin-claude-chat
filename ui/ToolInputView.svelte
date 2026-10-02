<script lang="ts">
  import DiffView from "./DiffView.svelte";
  import type { ToolInput } from "./host";

  let { input, summary }: { input?: ToolInput; summary: string } = $props();
</script>

{#if input?.kind === "bash"}
  {#if input.description}<p class="caption">{input.description}</p>{/if}
  <pre class="command"><span class="prompt">$</span> {input.command}</pre>
{:else if input?.kind === "edit"}
  <p class="caption">{input.file_path}</p>
  {#each input.edits as edit, index (index)}
    <DiffView before={edit.old_string} after={edit.new_string} />
  {/each}
  {#if input.hidden_edits}<p class="caption">{input.hidden_edits} more {input.hidden_edits === 1 ? "edit" : "edits"} not shown</p>{/if}
{:else if input?.kind === "write"}
  <p class="caption">{input.file_path}</p>
  <DiffView before="" after={input.content} />
{:else}
  <pre class="command">{summary}</pre>
{/if}

<style>
  .caption { margin: 0 0 var(--planeai-space-1); font-family: var(--planeai-font-mono); font-size: 12px; color: var(--planeai-text-muted); }
  .command { margin: 0; padding: var(--planeai-space-2) var(--planeai-space-3); overflow-x: auto; font-family: var(--planeai-font-mono); font-size: 12px; white-space: pre-wrap; word-break: break-word; border: 1px solid var(--planeai-border); border-radius: var(--planeai-radius); background: var(--planeai-surface); }
  .prompt { color: var(--planeai-text-subtle); user-select: none; }
</style>
