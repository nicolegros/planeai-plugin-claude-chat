<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import type { SessionMeta } from "./host";
  import { modelLabel, modelName } from "./models";
  import { usageTip } from "./usage";

  let { meta, onMode, onModel, onHandoff, actions }: { meta: SessionMeta; onMode: (mode: string) => void; onModel: (model: string | null) => void; onHandoff?: () => void; actions: Snippet } = $props();

  const MODES: Record<string, { label: string }> = {
    default: { label: "Ask before acting" },
    acceptEdits: { label: "Accept edits" },
    plan: { label: "Plan only" },
    bypassPermissions: { label: "Bypass permissions" },
  };
  const DEFAULT_MODEL = "";
  const RING = 2 * Math.PI * 6;

  const modeLabel = (mode: string) => MODES[mode]?.label ?? mode;
  // A mode set outside the chat, as from the terminal, may not be one it offers; it still shows as selected.
  const unlistedMode = $derived(!meta.modes.includes(meta.permission_mode));
  // A model typed with /model may not be in Claude's list; it still shows as selected.
  const unlisted = $derived(meta.model !== null && !meta.models.some((model) => model.value === meta.model));
  const percent = $derived(meta.context ? Math.round(meta.context.percentage) : 0);
  // Read when the meter is hovered or focused, so a window that has reset since is left out.
  let now = $state(new Date());
  const usage = $derived(usageTip(meta, now));
</script>

<div class="settings">
  {#if meta.modes.length > 0}
    <label class="chip" data-mode={meta.permission_mode} data-tip="Permission mode">
      <Icon name="shield" size={12} />
      <span class="chip-label">{modeLabel(meta.permission_mode)}</span>
      <select value={meta.permission_mode} onchange={(event) => onMode(event.currentTarget.value)} aria-label="Permission mode">
        {#if unlistedMode}
          <option value={meta.permission_mode}>{modeLabel(meta.permission_mode)}</option>
        {/if}
        {#each meta.modes as mode (mode)}
          <option value={mode}>{modeLabel(mode)}</option>
        {/each}
      </select>
    </label>
  {/if}
  <label class="chip" data-tip="Model">
    <Icon name="sparkle" size={12} />
    <span class="chip-label">{modelLabel(meta)}</span>
    <select value={meta.model ?? DEFAULT_MODEL} onchange={(event) => onModel(event.currentTarget.value || null)} aria-label="Model">
      <option value={DEFAULT_MODEL}>{meta.model === null && meta.active_model ? `Default (${modelName(meta.active_model)})` : "Default"}</option>
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
    <!-- Focusable so keyboard and screen reader users reach the usage the tooltip shows. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <span
      class="context"
      role="meter"
      tabindex="0"
      aria-label="Context usage"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={usage}
      data-tip={usage}
      data-tip-end
      onpointerenter={() => (now = new Date())}
      onfocus={() => (now = new Date())}
    >
      <svg class="ring" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6" fill="none" stroke="var(--planeai-border-strong)" stroke-width="2" />
        <circle class="fill" class:high={percent >= 80} cx="8" cy="8" r="6" fill="none" stroke-width="2" stroke-linecap="round" stroke-dasharray="{(RING * Math.min(100, percent)) / 100} {RING}" transform="rotate(-90 8 8)" />
      </svg>
      <span class="context-label">{percent}%</span>
    </span>
  {/if}
  {#if onHandoff}
    <button type="button" class="icon-control quiet" onclick={onHandoff} data-tip="Continue in Claude Code's terminal" data-tip-end aria-label="Continue in Claude Code's terminal"><Icon name="terminal" /></button>
  {/if}
  {@render actions()}
</div>

<style>
  .chip { position: relative; display: inline-flex; flex: 0 1 auto; align-items: center; gap: calc(5 * var(--chat-unit)); min-width: 0; min-height: calc(28 * var(--chat-unit)); padding: 0 var(--chat-space-2); border-radius: var(--chat-radius); color: color-mix(in srgb, var(--planeai-text) 80%, transparent); font-size: var(--chat-size-xs); }
  .chip:hover, .chip:focus-within { background: var(--planeai-accent-subtle); color: var(--planeai-text); }
  .chip:has(select:focus-visible) { outline: 2px solid var(--planeai-accent); outline-offset: 2px; }
  /* Modes that act without asking are tinted, quietly enough not to compete with the conversation. */
  .chip:is([data-mode="acceptEdits"], [data-mode="bypassPermissions"]) .chip-label { color: color-mix(in srgb, var(--planeai-danger) 55%, var(--planeai-text-muted)); }
  .chip[data-mode="plan"] .chip-label { color: color-mix(in srgb, var(--planeai-warning) 55%, var(--planeai-text-muted)); }
  .chip-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* The native select stays clickable and keyboard-operable over the compact label. */
  .chip select { position: absolute; inset: 0; width: 100%; min-height: 0; padding: 0; opacity: 0; cursor: pointer; }
  .settings, .status { display: flex; align-items: center; gap: var(--chat-space-1); min-width: 0; }
  .status { margin-left: auto; }
  .context { display: inline-flex; flex: none; align-items: center; gap: calc(5 * var(--chat-unit)); padding: 0 var(--chat-space-1); color: var(--planeai-text-subtle); font-size: var(--chat-size-xs); font-variant-numeric: tabular-nums; }
  .ring { width: calc(16 * var(--chat-unit)); height: calc(16 * var(--chat-unit)); }
  .fill { stroke: var(--planeai-text-muted); }
  .fill.high { stroke: var(--planeai-warning); }
  .quiet { border-color: transparent; background: transparent; color: var(--planeai-text-muted); }
</style>
