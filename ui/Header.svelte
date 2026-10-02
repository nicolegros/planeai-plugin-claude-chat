<script lang="ts">
  import type { SessionMeta } from "./host";

  let { meta, onMode, onModel }: { meta: SessionMeta; onMode: (mode: string) => void; onModel: (model: string | null) => void } = $props();

  const MODE_LABELS: Record<string, string> = {
    default: "Ask before acting",
    acceptEdits: "Accept edits",
    plan: "Plan only",
    bypassPermissions: "Bypass permissions",
  };
  const DEFAULT_MODEL = "";

  // The init model is a resolved id; show it as the default when no override is set.
  const knownModel = $derived(meta.models.some((model) => model.value === meta.model));
  const contextLabel = $derived(meta.context ? `${Math.round(meta.context.percentage)}% context · ${Math.round(meta.context.total_tokens / 1000)}k / ${Math.round(meta.context.max_tokens / 1000)}k` : "");
</script>

<header class="header">
  <label>
    <span class="label">Model</span>
    <select value={knownModel ? meta.model : DEFAULT_MODEL} onchange={(event) => onModel(event.currentTarget.value || null)} aria-label="Model">
      <option value={DEFAULT_MODEL}>{knownModel || !meta.model ? "Default" : `Default (${meta.model})`}</option>
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
    <div class="context" title={contextLabel} aria-label={contextLabel}>
      <span class="meter"><span class="fill" style:width="{Math.min(100, meta.context.percentage)}%" class:high={meta.context.percentage >= 80}></span></span>
      <span class="context-label">{contextLabel}</span>
    </div>
  {/if}
</header>

<style>
  .header { display: flex; flex-wrap: wrap; align-items: center; gap: var(--planeai-space-3); padding: var(--planeai-space-2) var(--planeai-space-4); border-bottom: 1px solid var(--planeai-border); }
  label { display: flex; align-items: center; gap: var(--planeai-space-2); }
  .label { color: var(--planeai-text-subtle); font-size: 11.5px; }
  select { min-height: 28px; padding-top: 3px; padding-bottom: 3px; font-size: 12.5px; }
  .context { display: flex; align-items: center; gap: var(--planeai-space-2); margin-left: auto; }
  .meter { width: 64px; height: 4px; border-radius: 2px; background: var(--planeai-border); overflow: hidden; }
  .fill { display: block; height: 100%; background: var(--planeai-accent); }
  .fill.high { background: var(--planeai-warning); }
  .context-label { color: var(--planeai-text-subtle); font-size: 11.5px; font-variant-numeric: tabular-nums; }
</style>
