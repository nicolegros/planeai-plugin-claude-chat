<script lang="ts">
  import Checklist from "./Checklist.svelte";
  import DiffPreview from "./DiffPreview.svelte";
  import Icon from "./Icon.svelte";
  import OutputTail from "./OutputTail.svelte";
  import { previewOf } from "./preview";
  import Spinner from "./Spinner.svelte";
  import ToolDetail from "./ToolDetail.svelte";
  import { viewTool, type ToolEntry } from "./tools";

  let { tools, root }: { tools: ToolEntry[]; root?: string } = $props();
  const uid = $props.id();
  let open = $state<Record<string, boolean>>({});
</script>

<ul class="steps">
  {#each tools as tool (tool.id)}
    {@const view = viewTool(tool, root ?? undefined)}
    {@const verb = view.verbs[view.state === "running" ? 0 : 1]}
    {@const detailId = `${uid}-${tool.id}`}
    <li class="tool" data-state={view.state}>
      <button type="button" class="step" aria-expanded={!!open[tool.id]} aria-controls={detailId} onclick={() => (open[tool.id] = !open[tool.id])}>
        <span class="icon">{#if view.state === "running"}<Spinner />{:else}<Icon name={view.icon} />{/if}</span>
        <span class="sentence">
          {#if view.lead}
            {view.lead}<code class="quiet">{view.target}</code>
          {:else}
            {verb}
            {#if view.style === "code"}<code>{view.target}</code>
            {:else if view.style === "file"}<strong>{view.target}</strong>
            {:else}{view.target}{/if}
            {#if view.folder}<span class="dim"> in {view.folder}</span>{/if}
            {#if view.note}<span class="dim"> · {view.note}</span>{/if}
          {/if}
        </span>
        <span class="meta">
          {#if view.state === "failed"}<span class="failed">Failed</span>{/if}
          {#if view.added}<span class="added">+{view.added}</span>{/if}
          {#if view.removed}<span class="removed">−{view.removed}</span>{/if}
          {#if view.meta && view.state !== "failed"}<span>{view.meta}</span>{/if}
        </span>
        <span class="chevron"><Icon name="chevron" size={12} /></span>
      </button>
      {#if view.todos}
        <div class="nested"><Checklist todos={view.todos} /></div>
      {/if}
      {#if open[tool.id]}
        <div class="nested" id={detailId}><ToolDetail {tool} /></div>
      {:else}
        {@const preview = previewOf(tool)}
        {#if preview?.kind === "diff"}
          <div class="preview"><DiffPreview edits={preview.edits} /></div>
        {:else if preview?.kind === "output"}
          <div class="preview"><OutputTail output={preview.output} failed={preview.failed} /></div>
        {:else if preview?.kind === "answer"}
          <p class="preview answer">{preview.text}</p>
        {/if}
      {/if}
    </li>
  {/each}
</ul>

<style>
  .steps { display: grid; grid-template-columns: minmax(0, 1fr); gap: calc(2 * var(--chat-unit)); margin: 0; padding: 0; list-style: none; }
  .step { display: flex; align-items: center; gap: var(--chat-space-2); width: calc(100% + calc(16 * var(--chat-unit))); min-height: calc(28 * var(--chat-unit)); margin-left: calc(-8 * var(--chat-unit)); padding: calc(3 * var(--chat-unit)) calc(8 * var(--chat-unit)); border: 0; border-radius: calc(6 * var(--chat-unit)); background: none; color: var(--planeai-text-muted); font: inherit; font-size: var(--chat-size-sm); text-align: left; }
  .step:hover:not(:disabled) { background: var(--planeai-accent-subtle); color: var(--planeai-text); }
  .icon { display: grid; place-items: center; flex: none; width: calc(16 * var(--chat-unit)); color: var(--planeai-text-subtle); }
  [data-state="failed"] .icon { color: var(--planeai-danger); }
  .sentence { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  strong { color: var(--planeai-text); font-weight: 600; }
  code { margin-left: calc(2 * var(--chat-unit)); padding: 1px calc(5 * var(--chat-unit)); border-radius: calc(4 * var(--chat-unit)); background: var(--planeai-surface-raised); color: var(--planeai-text); font-family: var(--chat-code-font); font-size: var(--chat-size-xs); }
  code.quiet { margin-left: calc(6 * var(--chat-unit)); padding: 0; background: none; color: var(--planeai-text-subtle); }
  .dim { color: var(--planeai-text-subtle); }
  .meta { display: flex; flex: none; gap: calc(6 * var(--chat-unit)); color: var(--planeai-text-subtle); font-size: var(--chat-size-xs); font-variant-numeric: tabular-nums; }
  .added { color: var(--planeai-success); }
  .removed, .failed { color: var(--planeai-danger); }
  .chevron { flex: none; color: var(--planeai-text-subtle); opacity: 0; transition: transform 120ms, opacity 120ms; }
  .step:hover .chevron, .step:focus-visible .chevron, [aria-expanded="true"] .chevron { opacity: 1; }
  [aria-expanded="true"] .chevron { transform: rotate(90deg); }
  /* Lines up with the sentence, past the icon. */
  .preview { margin: calc(2 * var(--chat-unit)) 0 calc(8 * var(--chat-unit)) calc(24 * var(--chat-unit)); }
  .answer { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; color: var(--planeai-text-muted); font-size: var(--chat-size-sm); white-space: pre-line; }
  .nested { margin: calc(2 * var(--chat-unit)) 0 calc(8 * var(--chat-unit)) calc(7 * var(--chat-unit)); padding-left: calc(16 * var(--chat-unit)); border-left: 1px solid var(--planeai-border-strong); }
</style>
