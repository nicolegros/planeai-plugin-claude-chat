<script lang="ts">
  import Diff from "./Diff.svelte";
  import type { ToolInput } from "./host";

  /** `inline`: inside a step, whose line already names the file and describes the command. */
  let { input, summary, output = "", inline = false }: { input?: ToolInput; summary: string; output?: string; inline?: boolean } = $props();
  const written = $derived(input?.kind === "write" ? [{ old_string: "", new_string: input.content }] : []);
</script>

{#if input?.kind === "bash"}
  {#if input.description && !inline}<p class="description">{input.description}</p>{/if}
  <pre class="command"><span class="prompt">$</span> {input.command}{#if output}<span class="output">{"\n"}{output}</span>{/if}</pre>
{:else if input?.kind === "edit"}
  {#if !inline}<p class="caption">{input.file_path}</p>{/if}
  <Diff edits={input.edits} />
  {#if input.hidden_edits}<p class="caption">{input.hidden_edits} more {input.hidden_edits === 1 ? "edit" : "edits"} not shown</p>{/if}
{:else if input?.kind === "write"}
  {#if !inline}<p class="caption">{input.file_path}</p>{/if}
  <Diff edits={written} />
{:else}
  <pre class="command">{output || summary}</pre>
{/if}

<style>
  .caption { margin: 0 0 var(--chat-space-1); font-family: var(--chat-code-font); font-size: var(--chat-size-sm); color: var(--planeai-text-muted); }
  .description { margin: 0 0 var(--chat-space-1); font-size: var(--chat-size-sm); color: var(--planeai-text-muted); }
  .command { margin: 0; max-height: calc(320 * var(--chat-unit)); padding: var(--chat-space-2) var(--chat-space-3); overflow: auto; font-family: var(--chat-code-font); font-size: var(--chat-size-sm); white-space: pre-wrap; word-break: break-word; border: 1px solid var(--planeai-border); border-radius: var(--chat-radius); background: var(--planeai-surface); }
  .prompt { color: var(--planeai-text-subtle); user-select: none; }
  .output { color: var(--planeai-text-muted); }
</style>
