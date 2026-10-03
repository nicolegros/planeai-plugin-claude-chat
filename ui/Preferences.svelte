<script lang="ts">
  import { onMount } from "svelte";
  import { appearanceStyle, familyProblem, FONT_SIZE, normalizeAppearance, validSize } from "../src/appearance";
  import type { Appearance, PreferencesUiContext } from "./host";

  let { context }: { context: PreferencesUiContext } = $props();

  const STATUS_ID = "claude-chat-appearance-status";

  let font = $state("");
  let codeFont = $state("");
  /** A number input binds `undefined` while it is empty or not a number. */
  let size = $state<number | undefined>();
  let failure = $state<string | null>(null);
  /** Until the saved settings are known, an edit would save over the fields not shown yet. */
  let loaded = $state(false);
  /** Saved, but open chats could not be told; they read the settings when they open. */
  let unannounced = $state(false);
  /** Saves run one after another, so the last edit is the one that sticks. */
  let saving: Promise<unknown> = Promise.resolve();

  const appearance = $derived(normalizeAppearance({ font_family: font, code_font_family: codeFont, font_size: size }));
  const fontProblem = $derived(familyProblem(font));
  const codeFontProblem = $derived(familyProblem(codeFont));
  const sizeProblem = $derived(size === undefined || validSize(size) ? null : `Size must be a whole number from ${FONT_SIZE.min} to ${FONT_SIZE.max}.`);
  const problem = $derived(fontProblem ?? codeFontProblem ?? sizeProblem);

  function describe(reason: unknown): string {
    return reason instanceof Error ? reason.message : String(reason);
  }

  async function load(): Promise<void> {
    failure = null;
    try {
      const saved = normalizeAppearance(await context.host.settings.get());
      font = saved.font_family ?? "";
      codeFont = saved.code_font_family ?? "";
      size = saved.font_size;
      loaded = true;
    } catch (reason) {
      failure = `Could not load: ${describe(reason)}`;
    }
  }

  onMount(() => void load());

  function save(next: Appearance): void {
    saving = saving.then(async () => {
      try {
        await context.host.settings.replace({ ...next });
        failure = null;
      } catch (reason) {
        failure = `Could not save: ${describe(reason)}`;
        return;
      }
      try {
        await context.host.call("claude.appearance.changed", { appearance: next });
        unannounced = false;
      } catch {
        unannounced = true;
      }
    });
  }

  /** Saves a finished edit; the preview follows every keystroke on its own. */
  function onChange(): void {
    if (loaded && !problem) save(appearance);
  }

  function reset(): void {
    font = "";
    codeFont = "";
    size = undefined;
    save({});
  }
</script>

<section class="pane" aria-labelledby="claude-chat-appearance">
  <h3 id="claude-chat-appearance">Claude Chat</h3>
  <div class="fields">
    <label class="family">
      <span>Font</span>
      <input bind:value={font} disabled={!loaded} onchange={onChange} placeholder="PlaneAI's font" spellcheck="false" aria-invalid={!!fontProblem} aria-describedby={fontProblem ? STATUS_ID : undefined} />
    </label>
    <label class="family">
      <span>Code font</span>
      <input bind:value={codeFont} disabled={!loaded} onchange={onChange} placeholder="PlaneAI's monospace font" spellcheck="false" aria-invalid={!!codeFontProblem} aria-describedby={codeFontProblem ? STATUS_ID : undefined} />
    </label>
    <label class="size">
      <span>Size</span>
      <input type="number" bind:value={size} disabled={!loaded} onchange={onChange} min={FONT_SIZE.min} max={FONT_SIZE.max} step="1" placeholder={String(FONT_SIZE.default)} aria-invalid={!!sizeProblem} aria-describedby={sizeProblem ? STATUS_ID : undefined} />
    </label>
    {#if loaded}
      <button type="button" onclick={reset}>Reset to defaults</button>
    {:else if failure}
      <button type="button" onclick={() => void load()}>Retry</button>
    {/if}
  </div>
  <!-- Always present, so invalid fields can point at it and only problems are announced. -->
  <p id={STATUS_ID} class="visually-hidden" aria-live="polite">{problem ?? ""}</p>
  <!-- One line whatever it says: PlaneAI gives this pane a fixed-height frame. -->
  {#if problem}
    <p class="line error" aria-hidden="true" title={problem}>{problem}</p>
  {:else if failure}
    <p class="line error" role="alert" title={failure}>{failure}</p>
  {:else if unannounced}
    <p class="line" role="status">Saved. Open chats use it when they are reopened.</p>
  {:else}
    <p class="line" aria-hidden="true" style={appearanceStyle(appearance)}>Claude's replies look like this, with <code>inline code</code> in the code font.</p>
  {/if}
</section>

<style>
  .pane { display: grid; gap: var(--planeai-space-2); }
  .fields { display: flex; align-items: flex-end; gap: var(--planeai-space-2); }
  label { display: grid; gap: var(--planeai-space-1); }
  label span { color: var(--planeai-text-subtle); font-size: 11.5px; }
  .family { flex: 1 1 0; min-width: 0; }
  .size input { width: 72px; }
  input { min-width: 0; padding-top: 5px; padding-bottom: 5px; }
  input[aria-invalid="true"] { border-color: var(--planeai-danger); }
  button { flex: none; }
  .line { overflow: hidden; color: var(--planeai-text-muted); font-family: var(--chat-font); font-size: var(--chat-size); line-height: 1.45; text-overflow: ellipsis; white-space: nowrap; }
  .line code { font-family: var(--chat-code-font); font-size: calc(var(--chat-size) - 0.5px); }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .error { color: var(--planeai-danger); font-family: inherit; font-size: 12px; }
</style>
