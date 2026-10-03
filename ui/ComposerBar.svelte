<script lang="ts">
  import Icon from "./Icon.svelte";
  import type { SessionMeta } from "./host";

  let { meta, onMode, onModel, onHandoff }: { meta: SessionMeta; onMode: (mode: string) => void; onModel: (model: string | null) => void; onHandoff: () => void } = $props();

  const MODE_LABELS: Record<string, string> = {
    default: "Ask before acting",
    acceptEdits: "Accept edits",
    plan: "Plan only",
    bypassPermissions: "Bypass permissions",
  };
  const DEFAULT_MODEL = "";
  const RING = 2 * Math.PI * 6;

  // A model typed with /model may not be in Claude's list; it still shows as selected.
  const unlisted = $derived(meta.model !== null && !meta.models.some((model) => model.value === meta.model));
  const percent = $derived(meta.context ? Math.round(meta.context.percentage) : 0);
</script>

<select class="quiet" value={meta.model ?? DEFAULT_MODEL} onchange={(event) => onModel(event.currentTarget.value || null)} aria-label="Model">
  <option value={DEFAULT_MODEL}>{meta.model === null && meta.active_model ? `Default (${meta.active_model})` : "Default"}</option>
  {#if unlisted}
    <option value={meta.model}>{meta.model}</option>
  {/if}
  {#each meta.models as model (model.value)}
    <option value={model.value}>{model.label}</option>
  {/each}
</select>
{#if meta.modes.length > 0}
  <select class="quiet" value={meta.permission_mode} onchange={(event) => onMode(event.currentTarget.value)} aria-label="Permission mode">
    {#each meta.modes as mode (mode)}
      <option value={mode}>{MODE_LABELS[mode] ?? mode}</option>
    {/each}
  </select>
{/if}
<span class="spacer"></span>
{#if meta.context}
  <span class="context" title="{Math.round(meta.context.total_tokens / 1000)}k of {Math.round(meta.context.max_tokens / 1000)}k tokens of context used">
    <svg width="16" height="16" viewBox="0 0 16 16" role="meter" aria-label="Context usage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <circle cx="8" cy="8" r="6" fill="none" stroke="var(--planeai-border-strong)" stroke-width="2" />
      <circle class="fill" class:high={percent >= 80} cx="8" cy="8" r="6" fill="none" stroke-width="2" stroke-linecap="round" stroke-dasharray="{(RING * Math.min(100, percent)) / 100} {RING}" transform="rotate(-90 8 8)" />
    </svg>
    <span class="context-label">{percent}%</span>
  </span>
{/if}
<button type="button" class="icon-button" onclick={onHandoff} title="Continue this conversation in Claude Code's terminal UI" aria-label="Open in terminal"><Icon name="terminal" /></button>

<style>
  .quiet { min-width: 0; min-height: 26px; padding: 2px 24px 2px 8px; border-color: transparent; background-color: transparent; background-position: calc(100% - 11px) 50%, calc(100% - 7px) 50%; color: var(--planeai-text-muted); font-size: var(--chat-size-xs); text-overflow: ellipsis; }
  .quiet:hover { background-color: var(--planeai-accent-subtle); color: var(--planeai-text); }
  .spacer { flex: 1; }
  .context { display: inline-flex; flex: none; align-items: center; gap: 5px; padding: 0 var(--planeai-space-1); color: var(--planeai-text-subtle); font-size: var(--chat-size-xs); font-variant-numeric: tabular-nums; }
  .fill { stroke: var(--planeai-text-muted); }
  .fill.high { stroke: var(--planeai-warning); }
  .icon-button { display: grid; flex: none; place-items: center; width: 28px; height: 28px; min-height: 0; padding: 0; border-color: transparent; background: transparent; color: var(--planeai-text-muted); }
</style>
