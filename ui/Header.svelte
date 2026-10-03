<script lang="ts">
  import type { SessionMeta } from "./host";

  let { meta, onMode, onModel, onHandoff }: { meta: SessionMeta; onMode: (mode: string) => void; onModel: (model: string | null) => void; onHandoff?: () => void } = $props();

  const MODE_LABELS: Record<string, string> = {
    default: "Ask before acting",
    acceptEdits: "Accept edits",
    plan: "Plan only",
    bypassPermissions: "Bypass permissions",
  };
  const DEFAULT_MODEL = "";

  // A model typed with /model may not be in Claude's list; it still shows as selected.
  const unlisted = $derived(meta.model !== null && !meta.models.some((model) => model.value === meta.model));
  const contextLabel = $derived(meta.context ? `${Math.round(meta.context.percentage)}% context · ${Math.round(meta.context.total_tokens / 1000)}k / ${Math.round(meta.context.max_tokens / 1000)}k` : "");
</script>

<header class="header">
  <label>
    <span class="label">Model</span>
    <select value={meta.model ?? DEFAULT_MODEL} onchange={(event) => onModel(event.currentTarget.value || null)} aria-label="Model">
      <option value={DEFAULT_MODEL}>{meta.model === null && meta.active_model ? `Default (${meta.active_model})` : "Default"}</option>
      {#if unlisted}
        <option value={meta.model}>{meta.model}</option>
      {/if}
      {#each meta.models as model (model.value)}
        <option value={model.value}>{model.label}</option>
      {/each}
    </select>
  </label>
  {#if meta.modes.length > 0}
    <label>
      <span class="label">Mode</span>
      <select value={meta.permission_mode} onchange={(event) => onMode(event.currentTarget.value)} aria-label="Permission mode">
        {#each meta.modes as mode (mode)}
          <option value={mode}>{MODE_LABELS[mode] ?? mode}</option>
        {/each}
      </select>
    </label>
  {/if}
  {#if meta.context}
    <div class="context" title={contextLabel}>
      <span class="meter" role="meter" aria-label="Context usage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(meta.context.percentage)}>
        <span class="fill" style:width="{Math.min(100, meta.context.percentage)}%" class:high={meta.context.percentage >= 80}></span>
      </span>
      <span class="context-label">{contextLabel}</span>
    </div>
  {/if}
  {#if onHandoff && !meta.handed_off}
    <button type="button" class="handoff" class:pushed={!meta.context} onclick={onHandoff} title="Continue this conversation in Claude Code's terminal UI">Open in terminal</button>
  {/if}
</header>

<style>
  .header { display: flex; flex-wrap: wrap; align-items: center; gap: var(--planeai-space-3); padding: var(--planeai-space-2) var(--planeai-space-4); border-bottom: 1px solid var(--planeai-border); }
  label { display: flex; align-items: center; gap: var(--planeai-space-2); }
  .label { color: var(--planeai-text-subtle); font-size: var(--chat-size-xs); }
  select { min-height: 28px; padding-top: 3px; padding-bottom: 3px; font-size: var(--chat-size-code); }
  .context { display: flex; align-items: center; gap: var(--planeai-space-2); margin-left: auto; }
  .meter { width: 64px; height: 4px; border-radius: 2px; background: var(--planeai-border); overflow: hidden; }
  .fill { display: block; height: 100%; background: var(--planeai-accent); }
  .fill.high { background: var(--planeai-warning); }
  .handoff { min-height: 28px; padding: 3px 10px; font-size: var(--chat-size-code); }
  .handoff.pushed { margin-left: auto; }
  .context-label { color: var(--planeai-text-subtle); font-size: var(--chat-size-xs); font-variant-numeric: tabular-nums; }
</style>
