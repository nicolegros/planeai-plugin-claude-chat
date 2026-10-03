<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import type { SessionMeta } from "./host";
  import { modelLabel } from "./models";

  let { meta, onMode, onModel, onHandoff, actions }: { meta: SessionMeta; onMode: (mode: string) => void; onModel: (model: string | null) => void; onHandoff: () => void; actions: Snippet } = $props();

  const MODES: Record<string, { short: string; label: string }> = {
    default: { short: "Ask", label: "Ask before acting" },
    acceptEdits: { short: "Edits", label: "Accept edits" },
    plan: { short: "Plan", label: "Plan only" },
    bypassPermissions: { short: "Bypass", label: "Bypass permissions" },
  };
  const DEFAULT_MODEL = "";
  const RING = 2 * Math.PI * 6;

  // A model typed with /model may not be in Claude's list; it still shows as selected.
  const unlisted = $derived(meta.model !== null && !meta.models.some((model) => model.value === meta.model));
  const percent = $derived(meta.context ? Math.round(meta.context.percentage) : 0);
</script>

<div class="settings">
{#if meta.modes.length > 0}
  <div class="modes" role="radiogroup" aria-label="Permission mode">
    {#each meta.modes as mode (mode)}
      <button
        type="button"
        role="radio"
        aria-checked={meta.permission_mode === mode}
        aria-label={MODES[mode]?.label ?? mode}
        title={MODES[mode]?.label ?? mode}
        data-mode={mode}
        onclick={() => onMode(mode)}>{MODES[mode]?.short ?? mode}</button
      >
    {/each}
  </div>
{/if}
<label class="model" title="Model">
  <Icon name="sparkle" size={12} />
  <span class="model-label">{modelLabel(meta)}</span>
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
</div>
<!-- One group, so in a narrow pane it wraps whole and stays on the right. -->
<div class="status">
{#if meta.context}
  <span class="context" title="{Math.round(meta.context.total_tokens / 1000)}k of {Math.round(meta.context.max_tokens / 1000)}k tokens of context used">
    <svg class="ring" viewBox="0 0 16 16" role="meter" aria-label="Context usage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <circle cx="8" cy="8" r="6" fill="none" stroke="var(--planeai-border-strong)" stroke-width="2" />
      <circle class="fill" class:high={percent >= 80} cx="8" cy="8" r="6" fill="none" stroke-width="2" stroke-linecap="round" stroke-dasharray="{(RING * Math.min(100, percent)) / 100} {RING}" transform="rotate(-90 8 8)" />
    </svg>
    <span class="context-label">{percent}%</span>
  </span>
{/if}
<button type="button" class="icon-button" onclick={onHandoff} title="Continue this conversation in Claude Code's terminal UI" aria-label="Open in terminal"><Icon name="terminal" /></button>
{@render actions()}
</div>

<style>
  .modes { display: inline-flex; flex: none; padding: calc(2 * var(--chat-unit)); border-radius: calc(8 * var(--chat-unit)); background: var(--planeai-canvas); }
  .modes button { min-height: calc(22 * var(--chat-unit)); padding: 1px calc(10 * var(--chat-unit)); border: 0; border-radius: calc(6 * var(--chat-unit)); background: transparent; color: var(--planeai-text-muted); font-size: var(--chat-size-xs); }
  .modes button:hover:not(:disabled) { background: transparent; color: var(--planeai-text); }
  .modes [aria-checked="true"], .modes [aria-checked="true"]:hover:not(:disabled) { background: var(--planeai-surface); color: var(--planeai-text); box-shadow: 0 1px calc(2 * var(--chat-unit)) color-mix(in srgb, var(--planeai-text) 14%, transparent); }
  /* Modes that act without asking stand out once picked. */
  .modes [aria-checked="true"]:is([data-mode="acceptEdits"], [data-mode="bypassPermissions"]), .modes [aria-checked="true"]:is([data-mode="acceptEdits"], [data-mode="bypassPermissions"]):hover:not(:disabled) { color: var(--planeai-danger); }
  .modes [aria-checked="true"][data-mode="plan"], .modes [aria-checked="true"][data-mode="plan"]:hover:not(:disabled) { color: var(--planeai-warning); }
  .model { position: relative; display: inline-flex; flex: none; align-items: center; gap: calc(5 * var(--chat-unit)); min-height: calc(26 * var(--chat-unit)); padding: 0 calc(8 * var(--chat-unit)); border-radius: calc(6 * var(--chat-unit)); color: var(--planeai-text-muted); font-size: var(--chat-size-xs); }
  .model:hover, .model:focus-within { background: var(--planeai-accent-subtle); color: var(--planeai-text); }
  .model:has(select:focus-visible) { outline: 2px solid var(--planeai-accent); outline-offset: 2px; }
  .model-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* The native select stays clickable and keyboard-operable over the compact label. */
  .model select { position: absolute; inset: 0; width: 100%; min-height: 0; padding: 0; opacity: 0; cursor: pointer; }
  .settings, .status { display: flex; align-items: center; gap: var(--chat-space-1); min-width: 0; }
  .status { margin-left: auto; }
  .context { display: inline-flex; flex: none; align-items: center; gap: calc(5 * var(--chat-unit)); padding: 0 var(--chat-space-1); color: var(--planeai-text-subtle); font-size: var(--chat-size-xs); font-variant-numeric: tabular-nums; }
  .ring { width: calc(16 * var(--chat-unit)); height: calc(16 * var(--chat-unit)); }
  .fill { stroke: var(--planeai-text-muted); }
  .fill.high { stroke: var(--planeai-warning); }
  .icon-button { display: grid; flex: none; place-items: center; width: calc(28 * var(--chat-unit)); height: calc(28 * var(--chat-unit)); min-height: 0; padding: 0; border-color: transparent; background: transparent; color: var(--planeai-text-muted); }
</style>
