<script lang="ts">
  import DiffView from "./DiffView.svelte";
  import type { ToolEntry } from "./tools";

  let { tool }: { tool: ToolEntry } = $props();
  const input = $derived(tool.input);
  const output = $derived(tool.result?.summary ?? "");
</script>

<div class="detail">
  {#if input?.kind === "bash"}
    <pre class="block"><span class="prompt">$ </span>{input.command}{#if output}<span class="output">{"\n"}{output}</span>{/if}</pre>
  {:else if input?.kind === "edit"}
    {#each input.edits as edit, index (index)}<DiffView before={edit.old_string} after={edit.new_string} />{/each}
    {#if input.hidden_edits}<p class="caption">{input.hidden_edits} more {input.hidden_edits === 1 ? "edit" : "edits"} not shown</p>{/if}
  {:else if input?.kind === "write"}
    <DiffView before="" after={input.content} />
  {:else}
    {#if input?.kind === "skill" && input.args}<p class="caption">{input.args}</p>{/if}
    <pre class="block output">{output || tool.summary}</pre>
  {/if}
  {#if tool.result?.is_error && input?.kind !== "bash"}<p class="caption failed">The tool reported an error.</p>{/if}
</div>

<style>
  .detail { display: grid; gap: var(--planeai-space-2); min-width: 0; }
  .block { margin: 0; max-height: 280px; overflow: auto; padding: var(--planeai-space-2) var(--planeai-space-3); border-radius: calc(var(--planeai-radius) - 2px); background: var(--planeai-canvas); font-family: var(--chat-code-font); font-size: var(--chat-size-sm); line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .prompt { color: var(--planeai-text-subtle); user-select: none; }
  .output { color: var(--planeai-text-muted); }
  .caption { color: var(--planeai-text-muted); font-size: var(--chat-size-sm); }
  .failed { color: var(--planeai-danger); }
</style>
