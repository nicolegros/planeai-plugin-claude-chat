<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import type { Question } from "./host";
  import { answered, emptyChoices, toAnswers, toggle, typeOther, type Choice } from "./questions";

  /** Takes the composer's place until answered: one question at a time, keyboard first. `null` skips them all. */
  let { questions, onAnswer }: { questions: Question[]; onAnswer: (answers: Record<string, string> | null) => void } = $props();

  const uid = $props.id();
  // Each question set mounts its own prompt, so its first value is the one to answer.
  let choices = $state<Choice[]>(emptyChoices(untrack(() => questions)));
  let step = $state(0);
  let cursor = $state(0);
  let list: HTMLElement | undefined = $state();
  let otherInput: HTMLInputElement | undefined = $state();
  const question = $derived(questions[step]);
  const choice = $derived(choices[step]);
  const last = $derived(step === questions.length - 1);
  const preview = $derived(question.options[cursor]?.preview);
  const hasPreviews = $derived(question.options.some((option) => option.preview));

  onMount(() => list?.focus());

  async function move(to: number): Promise<void> {
    step = to;
    cursor = 0;
    await tick();
    list?.focus();
  }

  function advance(): void {
    if (!answered(choices[step])) return;
    if (last) onAnswer(toAnswers(questions, choices));
    else void move(step + 1);
  }

  function choose(index: number): void {
    cursor = index;
    choices[step] = toggle(question, choice, question.options[index].label);
    if (!question.multi_select) advance();
  }

  function onListKey(event: KeyboardEvent): void {
    const number = Number(event.key);
    const handled = (() => {
      if (number >= 1 && number <= question.options.length) choose(number - 1);
      else if (event.key === "ArrowDown") cursor < question.options.length - 1 ? cursor++ : otherInput?.focus();
      else if (event.key === "ArrowUp") cursor = Math.max(0, cursor - 1);
      else if (event.key === "ArrowLeft" && step > 0) void move(step - 1);
      else if (event.key === " " && question.multi_select) choose(cursor);
      else if (event.key === "Enter") question.multi_select ? advance() : choose(cursor);
      else if (event.key === "Tab" && !event.shiftKey) otherInput?.focus();
      else if (event.key === "Escape") onAnswer(null);
      else return false;
      return true;
    })();
    if (handled) event.preventDefault();
  }

  function onOtherKey(event: KeyboardEvent): void {
    if (event.key === "Enter") advance();
    else if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) list?.focus();
    else if (event.key === "Escape") onAnswer(null);
    else return;
    event.preventDefault();
  }
</script>

<section class="prompt" aria-labelledby="{uid}-question">
  <p class="top">
    {#if question.header}<span class="chip">{question.header}</span>{/if}
    {#if questions.length > 1}<span class="progress">Question {step + 1} of {questions.length}</span>{/if}
  </p>
  <p class="question" id="{uid}-question">{question.question}</p>
  <div class="body" class:with-preview={hasPreviews}>
    <div class="choices">
      <ol
        class="options"
        bind:this={list}
        role="listbox"
        tabindex="0"
        aria-labelledby="{uid}-question"
        aria-multiselectable={question.multi_select}
        aria-activedescendant="{uid}-option-{cursor}"
        onkeydown={onListKey}
      >
        {#each question.options as option, index (option.label)}
          {@const picked = choice.picked.includes(option.label)}
          <!-- The listbox owns focus and every key, pointing at options through aria-activedescendant. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <li
            id="{uid}-option-{index}"
            class="option"
            class:cursor={cursor === index}
            role="option"
            aria-selected={picked}
            onclick={() => choose(index)}
            onpointerenter={() => (cursor = index)}
          >
            <span class="pointer" aria-hidden="true">{cursor === index ? "›" : ""}</span>
            <span class="number" aria-hidden="true">{index + 1}.</span>
            {#if question.multi_select}<span class="box" aria-hidden="true">{picked ? "[x]" : "[ ]"}</span>{/if}
            <span class="label" class:picked>{option.label}</span>
            {#if option.description}<span class="description">{option.description}</span>{/if}
          </li>
        {/each}
      </ol>
      <label class="other">
        <span class="number" aria-hidden="true">{question.options.length + 1}.</span>
        <input
          bind:this={otherInput}
          type="text"
          placeholder="Type something else"
          aria-label="Another answer"
          value={choice.other}
          oninput={(event) => (choices[step] = typeOther(question, choice, event.currentTarget.value))}
          onkeydown={onOtherKey}
        />
      </label>
    </div>
    {#if hasPreviews}
      <pre class="preview" aria-label="Preview">{preview ?? ""}</pre>
    {/if}
  </div>
  <div class="footer">
    <p class="keys">
      {question.multi_select ? "Space to toggle · Enter to continue" : `Enter or 1–${question.options.length} to choose`}{step > 0 ? " · ← back" : ""} · Esc to skip
    </p>
    <button type="button" class="quiet" onclick={() => onAnswer(null)}>Skip</button>
    {#if question.multi_select || choice.other.trim()}
      <button type="button" class="primary" disabled={!answered(choice)} onclick={advance}>{last ? "Submit" : "Continue"}</button>
    {/if}
  </div>
</section>

<style>
  .prompt { display: grid; gap: var(--chat-space-2); padding: var(--chat-space-3) var(--chat-space-4); border: 1px solid var(--planeai-border-strong); border-radius: 12px; background: var(--planeai-surface); }
  .prompt:focus-within { border-color: color-mix(in srgb, var(--planeai-text) 32%, transparent); }
  .top { display: flex; align-items: center; gap: var(--chat-space-2); }
  .top:empty { display: none; }
  .chip { padding: 0 var(--chat-space-2); border-radius: var(--chat-radius-sm); background: var(--planeai-surface-raised); color: var(--planeai-text-muted); font-size: var(--chat-size-xs); }
  .progress { color: var(--planeai-text-subtle); font-size: var(--chat-size-xs); }
  .question { font-weight: 600; }
  .body.with-preview { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--chat-space-3); }
  .choices { display: grid; min-width: 0; }
  .options { display: grid; margin: 0; padding: 0; list-style: none; outline: none; font-family: var(--chat-code-font); font-size: var(--chat-size-code); }
  .options:focus-visible .cursor { outline: 2px solid var(--planeai-accent); outline-offset: -2px; }
  .option, .other { display: flex; align-items: baseline; gap: var(--chat-space-2); min-width: 0; padding: 2px var(--chat-space-1); border-radius: var(--chat-radius-sm); color: var(--planeai-text-muted); cursor: pointer; }
  .option.cursor, .other:focus-within { background: var(--planeai-accent-subtle); color: var(--planeai-text); }
  .pointer { flex: none; width: 1ch; color: var(--planeai-text); }
  .number { flex: none; color: var(--planeai-text-subtle); }
  .other .number { margin-left: calc(1ch + var(--chat-space-2)); }
  .box { flex: none; }
  .label { flex: none; font-weight: 600; color: var(--planeai-text); }
  .label.picked { text-decoration: underline; text-underline-offset: calc(3 * var(--chat-unit)); }
  .description { min-width: 0; overflow: hidden; color: var(--planeai-text-subtle); font-family: var(--chat-font); font-size: var(--chat-size-sm); text-overflow: ellipsis; white-space: nowrap; }
  .other { cursor: text; font-family: var(--chat-code-font); font-size: var(--chat-size-code); }
  .other input { flex: 1; min-width: 0; padding: 0; border: 0; background: transparent; font: inherit; }
  .other input:focus-visible { outline: none; }
  .other input::placeholder { color: var(--planeai-text-subtle); }
  .preview { margin: 0; padding: var(--chat-space-3); overflow: auto; border-radius: var(--chat-radius-inner); background: var(--planeai-canvas); color: var(--planeai-text-muted); font-family: var(--chat-code-font); font-size: var(--chat-size-xs); line-height: 1.5; white-space: pre; }
  .footer { display: flex; align-items: center; gap: var(--chat-space-2); }
  .keys { flex: 1; min-width: 0; color: var(--planeai-text-subtle); font-size: var(--chat-size-xs); }
  .footer button { min-height: calc(28 * var(--chat-unit)); padding: calc(3 * var(--chat-unit)) var(--chat-space-3); font-size: var(--chat-size-sm); }
  .quiet { border-color: transparent; background: transparent; color: var(--planeai-text-muted); }
</style>
