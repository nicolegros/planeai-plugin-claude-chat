<script lang="ts">
  import Checklist from "./Checklist.svelte";
  import Icon from "./Icon.svelte";
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
      {/if}
    </li>
  {/each}
</ul>

<style>
  .steps { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; margin: 0; padding: 0; list-style: none; }
  .step { display: flex; align-items: center; gap: var(--planeai-space-2); width: calc(100% + 16px); min-height: 28px; margin-left: -8px; padding: 3px 8px; border: 0; border-radius: 6px; background: none; color: var(--planeai-text-muted); font: inherit; font-size: var(--chat-size-sm); text-align: left; }
  .step:hover:not(:disabled) { background: var(--planeai-accent-subtle); color: var(--planeai-text); }
  .icon { display: grid; place-items: center; flex: none; width: 16px; color: var(--planeai-text-subtle); }
  [data-state="failed"] .icon { color: var(--planeai-danger); }
  .sentence { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  strong { color: var(--planeai-text); font-weight: 600; }
  code { margin-left: 2px; padding: 1px 5px; border-radius: 4px; background: var(--planeai-surface-raised); color: var(--planeai-text); font-family: var(--chat-code-font); font-size: var(--chat-size-xs); }
  code.quiet { margin-left: 6px; padding: 0; background: none; color: var(--planeai-text-subtle); }
  .dim { color: var(--planeai-text-subtle); }
  .meta { display: flex; flex: none; gap: 6px; color: var(--planeai-text-subtle); font-size: var(--chat-size-xs); font-variant-numeric: tabular-nums; }
  .added { color: var(--planeai-success); }
  .removed, .failed { color: var(--planeai-danger); }
  .chevron { flex: none; color: var(--planeai-text-subtle); opacity: 0; transition: transform 120ms, opacity 120ms; }
  .step:hover .chevron, .step:focus-visible .chevron, [aria-expanded="true"] .chevron { opacity: 1; }
  [aria-expanded="true"] .chevron { transform: rotate(90deg); }
  .nested { margin: 2px 0 8px 7px; padding-left: 16px; border-left: 1px solid var(--planeai-border-strong); }
</style>
