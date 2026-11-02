<script lang="ts">
  import Checklist from "./Checklist.svelte";
  import Diff from "./Diff.svelte";
  import Icon from "./Icon.svelte";
  import OutputTail from "./OutputTail.svelte";
  import Spinner from "./Spinner.svelte";
  import ToolDetail from "./ToolDetail.svelte";
  import ToolSteps from "./ToolSteps.svelte";
  import { clock } from "./clock.svelte";
  import { plural } from "./format";
  import { answerOf, isAgent, isRunning, previewOf, stepGroups, verbOf, viewAgent, viewAgents, viewTool } from "./tools";
  import type { ToolEntry } from "./transcript.svelte";

  let { tools, root }: { tools: ToolEntry[]; root?: string } = $props();
  const uid = $props.id();
  let open = $state<Record<string, boolean>>({});
  /** A group of subagents stays open while one works, unless the user folded or unfolded it. */
  let groupOpen = $state<Record<string, boolean>>({});
  const working = $derived(tools.some((tool) => isAgent(tool) && isRunning(tool)));
  const now = $derived(clock.now);

  // Running subagents show how long they have run.
  $effect(() => {
    if (working) return clock.hold();
  });
</script>

{#snippet step(tool: ToolEntry)}
  {@const view = viewTool(tool, root)}
  {@const verb = verbOf(view)}
  {@const detailId = `${uid}-${tool.id}`}
  <li class="tool" data-state={view.state}>
    <button type="button" class="step" aria-expanded={!!open[tool.id]} aria-controls={open[tool.id] ? detailId : undefined} onclick={() => (open[tool.id] = !open[tool.id])}>
      <span class="icon">{#if view.state === "running"}<Spinner />{:else}<Icon name={view.icon} />{/if}</span>
      <span class="sentence">
        {#if view.lead}
          {view.lead}<code class="quiet">{view.target}</code>
        {:else}
          {verb}
          {#if view.style === "code"}<code>{view.target}</code>
          {:else if view.style === "name"}<strong>{view.target}</strong>
          {:else}{view.target}{/if}
          {#if view.folder}<span class="dim"> in {view.folder}</span>{/if}
          {#if view.note}<span class="dim"> · {view.note}</span>{/if}
        {/if}
      </span>
      <span class="meta">
        {#if view.state === "failed"}<span class="failed">Failed</span>{/if}
        {#if view.added}<span class="added">+{view.added}</span>{/if}
        {#if view.removed}<span class="removed">−{view.removed}</span>{/if}
        {#if view.count && view.state !== "failed"}<span>{view.count}</span>{/if}
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
        <div class="preview"><Diff edits={preview.edits} preview /></div>
      {:else if preview?.kind === "output"}
        <div class="preview"><OutputTail output={preview.output} failed={preview.failed} lines={preview.lines} /></div>
      {/if}
    {/if}
  </li>
{/snippet}

{#snippet agent(tool: ToolEntry)}
  {@const view = viewAgent(tool, now, root)}
  {@const detailId = `${uid}-${tool.id}`}
  <li class="tool" data-state={view.state}>
    <button type="button" class="step" aria-expanded={!!open[tool.id]} aria-controls={open[tool.id] ? detailId : undefined} onclick={() => (open[tool.id] = !open[tool.id])}>
      <span class="icon">{#if view.state === "running"}<Spinner />{:else}<Icon name="bot" />{/if}</span>
      <span class="sentence"><strong>{view.title}</strong></span>
      <span class="meta">
        {#if view.state === "failed"}<span class="failed">Failed</span>{/if}
        {#if tool.children.length}<span>{plural(tool.children.length, "step")}</span>{/if}
        {#if view.elapsed}<span>{view.elapsed}</span>{/if}
      </span>
      <span class="chevron"><Icon name="chevron" size={12} /></span>
    </button>
    {#if open[tool.id]}
      <div class="nested" id={detailId}>
        {#if tool.children.length}<ToolSteps tools={tool.children} {root} />{/if}
        {#if answerOf(tool)}<p class="answer">{answerOf(tool)}</p>{/if}
      </div>
    {:else if view.detail}
      <p class="preview agent-detail">{view.detail}</p>
    {/if}
  </li>
{/snippet}

<ul class="steps">
  {#each stepGroups(tools) as group (group.kind === "step" ? group.tool.id : `group-${group.tools[0].id}`)}
    {#if group.kind === "agents"}
      {@const view = viewAgents(group.tools, now)}
      {@const key = group.tools[0].id}
      {@const expanded = groupOpen[key] ?? view.running}
      {@const groupId = `${uid}-group-${key}`}
      <li class="tool" data-state={view.running ? "running" : "done"}>
        <button type="button" class="step" aria-expanded={expanded} aria-controls={expanded ? groupId : undefined} onclick={() => (groupOpen[key] = !expanded)}>
          <span class="icon">{#if view.running}<Spinner />{:else}<Icon name="bot" />{/if}</span>
          <span class="sentence"><strong>{view.label}</strong></span>
          <span class="meta">{#if view.elapsed}<span>{view.elapsed}</span>{/if}</span>
          <span class="chevron"><Icon name="chevron" size={12} /></span>
        </button>
        {#if expanded}
          <ul class="steps group" id={groupId}>
            {#each group.tools as tool (tool.id)}{@render agent(tool)}{/each}
          </ul>
        {/if}
      </li>
    {:else if isAgent(group.tool)}
      {@render agent(group.tool)}
    {:else}
      {@render step(group.tool)}
    {/if}
  {/each}
</ul>

<style>
  .steps { display: grid; grid-template-columns: minmax(0, 1fr); gap: calc(2 * var(--chat-unit)); margin: 0; padding: 0; list-style: none; }
  .step { display: flex; align-items: center; gap: var(--chat-space-2); width: calc(100% + calc(16 * var(--chat-unit))); min-height: calc(24 * var(--chat-unit)); margin-left: calc(-8 * var(--chat-unit)); padding: calc(3 * var(--chat-unit)) var(--chat-space-2); border: 0; border-radius: var(--chat-radius-sm); background: none; color: var(--planeai-text-muted); font: inherit; font-size: var(--chat-size); text-align: left; }
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
  .preview { margin: calc(2 * var(--chat-unit)) 0 var(--chat-space-2) var(--chat-space-6); }
  /* The latest step of a working subagent, or its answer, on one line under its row. */
  .agent-detail { overflow: hidden; color: var(--planeai-text-muted); font-size: var(--chat-size-sm); text-overflow: ellipsis; white-space: nowrap; }
  .group { margin: calc(2 * var(--chat-unit)) 0 var(--chat-space-1) var(--chat-space-4); }
  .answer { margin-top: var(--chat-space-2); color: var(--planeai-text-muted); font-size: var(--chat-size-sm); white-space: pre-line; }
  .nested { margin: calc(2 * var(--chat-unit)) 0 var(--chat-space-2) calc(7 * var(--chat-unit)); padding-left: var(--chat-space-4); border-left: 1px solid var(--planeai-border-strong); }
</style>
