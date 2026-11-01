<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import { appearanceStyle } from "../src/appearance";
  import { ChatSession } from "./chat-session.svelte";
  import CommandMenu from "./CommandMenu.svelte";
  import { matchCommands } from "./commands.svelte";
  import ComposerBar from "./ComposerBar.svelte";
  import Icon from "./Icon.svelte";
  import Markdown from "./Markdown.svelte";
  import PermissionCard from "./PermissionCard.svelte";
  import QuestionAnswers from "./QuestionAnswers.svelte";
  import QuestionPrompt from "./QuestionPrompt.svelte";
  import ToolSteps from "./ToolSteps.svelte";
  import { compacted, duration, turnSummary } from "./format";
  import { describeSteps } from "./tools";
  import { turns, type Block } from "./turns";
  import UserPrompt from "./UserPrompt.svelte";
  import type { CommandOption, ProviderUiContext } from "./host";

  let { context }: { context: ProviderUiContext } = $props();

  const session = new ChatSession(untrack(() => context));
  const { transcript, commands } = session;
  let draft = $state("");
  /** Streaming text re-rendered as markdown at most once per frame, not once per delta. */
  let liveMarkdown = $state("");
  let log: HTMLElement | undefined = $state();
  /** The floating dock's height, which the log leaves free at its end so the last line scrolls clear of it. */
  let dockHeight = $state(0);
  let composer: HTMLTextAreaElement | undefined = $state();
  let disconnect: (() => void) | undefined;
  let stickToBottom = true;

  const conversation = $derived(turns(transcript.entries));
  const root = $derived(transcript.meta.cwd ?? undefined);

  const uid = $props.id();
  const MENU_ID = `${uid}-commands`;
  /** Highlighted menu entry. */
  let active = $state(0);
  /** The draft the menu was dismissed for with Escape; it reopens once the draft changes. */
  let dismissed = $state<string | null>(null);
  // Only a lone `/word` opens the menu; once arguments start, it is out of the way.
  const commandQuery = $derived(/^\/(\S*)$/.exec(draft)?.[1] ?? null);
  const menuOpen = $derived(commandQuery !== null && dismissed !== draft);
  const matches = $derived(menuOpen && commands.list ? matchCommands(commands.list, commandQuery ?? "") : []);
  const activeIndex = $derived(Math.min(active, Math.max(0, matches.length - 1)));

  $effect(() => {
    if (menuOpen) untrack(() => commands.ensure());
  });

  $effect(() => {
    const live = transcript.live;
    if (!live) {
      liveMarkdown = "";
      return;
    }
    const frame = requestAnimationFrame(() => (liveMarkdown = live));
    return () => cancelAnimationFrame(frame);
  });

  async function scrollToBottom(): Promise<void> {
    if (!stickToBottom) return;
    await tick();
    if (log) log.scrollTop = log.scrollHeight;
  }

  // A taller draft, a question or the handed-off panel grows the dock; a log that was at the bottom stays there.
  $effect(() => {
    void dockHeight;
    untrack(() => void scrollToBottom());
  });

  function onScroll(): void {
    if (!log) return;
    stickToBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 32;
  }

  function send(): void {
    const text = draft.trim();
    if (!text || !session.send(text)) return;
    draft = "";
    stickToBottom = true;
    void resizeComposer();
  }

  /** Where typing goes: Claude's open question, otherwise the message box. */
  function focusInput(): void {
    (document.querySelector<HTMLElement>("[data-question-prompt] [role=listbox]") ?? composer)?.focus();
  }

  // PlaneAI focuses the chat's frame, not an element in it, when its pane takes the keyboard.
  function onWindowFocus(): void {
    requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) focusInput();
    });
  }

  const TYPING_TARGETS = "input, textarea, select, [contenteditable], [role=listbox]";
  const PRESSABLE = "button, a, summary, [tabindex]";

  /** Typing with nothing to type into, as after clicking the transcript or a button, goes to the message box. */
  function onWindowKeydown(event: KeyboardEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || target?.closest(TYPING_TARGETS)) return;
    if (event.key === "Escape" && session.working) {
      event.preventDefault();
      session.interrupt();
    } else if (event.key.length === 1 && !(event.key === " " && target?.closest(PRESSABLE))) {
      focusInput();
    }
  }

  // Answering a question or returning from the terminal brings the message box back; typing goes there again.
  let hadPrompt = false;
  $effect(() => {
    const prompt = session.dock.kind !== "composer";
    if (hadPrompt && !prompt) void tick().then(focusInput);
    hadPrompt = prompt;
  });

  async function resizeComposer(): Promise<void> {
    await tick();
    if (!composer) return;
    composer.style.height = "auto";
    // Its CSS max-height, which scales with the font size, caps the growth.
    composer.style.height = `${composer.scrollHeight}px`;
  }

  function onInput(): void {
    active = 0;
    dismissed = null;
    void resizeComposer();
  }

  /** Puts `/name ` in the composer so arguments can follow. */
  function complete(command: CommandOption): void {
    draft = `/${command.name} `;
    composer?.focus();
    void resizeComposer();
  }

  /** Handles menu keys; returns whether the key was the menu's. */
  function onMenuKey(event: KeyboardEvent): boolean {
    if (!menuOpen) return false;
    if (event.key === "Escape") {
      dismissed = draft;
      return true;
    }
    const command = matches[activeIndex];
    if (!command) return false;
    switch (event.key) {
      case "ArrowDown":
        active = (activeIndex + 1) % matches.length;
        return true;
      case "ArrowUp":
        active = (activeIndex - 1 + matches.length) % matches.length;
        return true;
      case "Tab":
        if (event.shiftKey) return false;
        complete(command);
        return true;
      case "Enter":
        if (event.shiftKey || event.isComposing) return false;
        // Like Claude Code's terminal UI: Enter runs the highlighted command, Tab completes it.
        draft = `/${command.name}`;
        send();
        return true;
      default:
        return false;
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (onMenuKey(event)) {
      event.preventDefault();
    } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    } else if (event.key === "Escape" && session.working) {
      event.preventDefault();
      session.interrupt();
    }
  }

  onMount(() => {
    disconnect = session.connect(() => void scrollToBottom());
    composer?.focus();
  });

  onDestroy(() => disconnect?.());
</script>

{#snippet block(item: Block)}
  {#if item.kind === "tools"}
    <ToolSteps tools={item.tools} {root} />
  {:else if item.entry.kind === "user"}
    <div class="follow-up"><p class="follow-up-label">Your follow-up</p><p class="follow-up-text">{item.entry.text}</p></div>
  {:else if item.entry.kind === "assistant"}
    <div class="message"><Markdown text={item.entry.text} onLink={(url) => session.openExternal(url)} /></div>
  {:else if item.entry.kind === "question"}
    {#if item.entry.resolved}
      <QuestionAnswers questions={item.entry.questions} answers={item.entry.answers} />
    {:else}
      <p class="asking"><span class="asking-dot" aria-hidden="true"></span>Claude is asking {item.entry.questions.length === 1 ? "a question" : `${item.entry.questions.length} questions`} · answer below</p>
    {/if}
  {:else if item.entry.kind === "permission"}
    {@const permission = item.entry.permission}
    <PermissionCard {permission} onRespond={(decision, reason) => session.respond(permission.request_id, decision, reason)} />
  {:else if item.entry.kind === "result"}
    <p class="turn-summary" class:failed={item.entry.is_error}>{turnSummary(item.entry)}</p>
  {:else if item.entry.kind === "error"}
    <p class="error">{item.entry.message}</p>
  {:else if item.entry.kind === "handoff"}
    <p class="divider">{item.entry.in_terminal ? "Continued in the terminal" : "Back in the chat. Turns taken in the terminal are in Claude's history but not shown here."}</p>
  {:else if item.entry.kind === "compacted"}
    <p class="divider">{compacted(item.entry)}</p>
  {:else if item.entry.kind === "cleared"}
    <p class="divider">Context cleared · Claude no longer sees the messages above</p>
  {:else if item.entry.kind === "notice"}
    <p class="notice">{item.entry.text}</p>
  {/if}
{/snippet}

{#snippet progress()}
  {#if transcript.live}
    <div class="message"><Markdown text={liveMarkdown || transcript.live} onLink={(url) => session.openExternal(url)} /></div>
  {:else if session.working}
    <p class="working" aria-hidden="true">{session.status === "needs_attention" ? "Waiting for your answer" : transcript.meta.compacting ? "Compacting the conversation" : "Claude is working"}</p>
  {/if}
{/snippet}

<svelte:window onfocus={onWindowFocus} onkeydown={onWindowKeydown} />

<main class="chat" style={appearanceStyle(session.appearance)}>
  <div class="log" bind:this={log} style:padding-bottom="{dockHeight}px" onscroll={onScroll} role="log" aria-label="Conversation" aria-busy={!!transcript.live}>
    {#if conversation.length === 0}
      {#if transcript.live || session.working}
        <div class="body">{@render progress()}</div>
      {:else}
        <p class="empty">Send a message to start Claude in this worktree, or type / for commands.</p>
      {/if}
    {/if}
    {#each conversation as turn, index (turn.seq)}
      <section class="turn">
        {#if turn.user}<UserPrompt text={turn.user.text} />{/if}
        <div class="body">
          {#if turn.folded.length > 0}
            {@const steps = describeSteps(turn.foldedTools)}
            <details class="work">
              <summary>
                <Icon name="chevron" size={12} />
                <span>{turn.result ? `Worked for ${duration(turn.result.duration_ms)}` : "Worked"}</span>
                <span class="steps">· {steps}</span>
              </summary>
              <div class="folded">
                {#each turn.folded as item (item.seq)}{@render block(item)}{/each}
              </div>
            </details>
          {/if}
          {#each turn.shown as item (item.seq)}{@render block(item)}{/each}
          {#if index === conversation.length - 1}{@render progress()}{/if}
          {#if turn.result}{@render block({ kind: "entry", seq: turn.result.seq, entry: turn.result })}{/if}
          {#each turn.after as item (item.seq)}{@render block(item)}{/each}
        </div>
      </section>
    {/each}
  </div>
  <p class="visually-hidden" role="status">{session.status === "needs_attention" ? "Claude is waiting for your answer" : session.working ? "Claude is working" : ""}</p>
  <div class="dock" bind:clientHeight={dockHeight}>
    {#if session.dock.kind === "question"}
      {@const question = session.dock.question}
      {#key question.request_id}<QuestionPrompt questions={question.questions} onAnswer={(answers) => session.answer(question.request_id, answers)} />{/key}
    {:else if session.dock.kind === "handed_off"}
      <div class="handed-off" role="status">
        <p>This conversation is continuing in a terminal tab. Closing that tab brings it back here.</p>
        <button type="button" class="primary" onclick={() => session.handback()}>Return to chat</button>
      </div>
    {:else}
      <form class="composer" onsubmit={(event) => { event.preventDefault(); send(); }}>
        {#if menuOpen}
          <CommandMenu
            id={MENU_ID}
            {matches}
            active={activeIndex}
            loading={commands.list === null && commands.error === null}
            error={commands.error}
            onPick={complete}
            onHover={(index) => (active = index)}
          />
        {/if}
        <textarea
          bind:this={composer}
          bind:value={draft}
          oninput={onInput}
          onkeydown={onKeydown}
          rows="1"
          placeholder={session.working ? "Queue a follow-up · Esc to stop" : "Message Claude · / for commands"}
          aria-label="Message Claude"
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          aria-controls={menuOpen && matches.length > 0 ? MENU_ID : undefined}
          aria-activedescendant={menuOpen && matches.length > 0 ? `${MENU_ID}-${activeIndex}` : undefined}
        ></textarea>
        <div class="bar">
          <ComposerBar meta={transcript.meta} onMode={(mode) => session.setMode(mode)} onModel={(model) => session.setModel(model)} onHandoff={session.canHandOff ? () => session.handoff() : undefined}>
            {#snippet actions()}
              {#if session.working}
                <button type="button" class="icon-control round stop" onclick={() => session.interrupt()} data-tip="Stop · Esc" data-tip-end aria-label="Stop"><Icon name="stop" size={12} /></button>
              {/if}
              <button type="submit" class="icon-control round primary" disabled={!draft.trim()} data-tip={session.working ? "Queue · Enter" : "Send · Enter"} data-tip-end aria-label={session.working ? "Queue" : "Send"}><Icon name="arrow-up" /></button>
            {/snippet}
          </ComposerBar>
        </div>
      </form>
    {/if}
  </div>
</main>

<style>
  .chat {
    /* The type scale, from the size in the plugin's settings; at 13px it is the chat's original one. */
    --chat-size-2xs: calc(var(--chat-size) - 2px);
    --chat-size-xs: calc(var(--chat-size) - 1.5px);
    --chat-size-sm: calc(var(--chat-size) - 1px);
    --chat-size-code: calc(var(--chat-size) - 0.5px);
    --chat-size-body: calc(var(--chat-size) + 0.5px);
    --chat-size-heading: calc(var(--chat-size) + 1px);
    --chat-line: calc(var(--chat-size) + 5px);
    --chat-line-text: calc(var(--chat-size) + 6px);
    --chat-line-heading: calc(var(--chat-size) + 7px);
    /* Spacing and control sizes grow with the text, so a larger font keeps the default proportions. */
    --chat-unit: calc(1px * var(--chat-scale, 1));
    --chat-space-1: calc(4 * var(--chat-unit));
    --chat-space-2: calc(8 * var(--chat-unit));
    --chat-space-3: calc(12 * var(--chat-unit));
    --chat-space-4: calc(16 * var(--chat-unit));
    --chat-space-5: calc(20 * var(--chat-unit));
    --chat-space-6: calc(24 * var(--chat-unit));
    --chat-radius: calc(8 * var(--chat-unit));
    --chat-radius-sm: calc(6 * var(--chat-unit));
    /* For a box nested inside a radius-sized one. */
    --chat-radius-inner: calc(var(--chat-radius) - calc(2 * var(--chat-unit)));
    /* Turns and the dock are centred on this lane, with at least the default gutter on each side. */
    --chat-lane: calc(736 * var(--chat-unit));
    --chat-gutter: max(var(--chat-space-5), (100% - var(--chat-lane)) / 2);
    /* Prompts and follow-ups sit in bubbles; the frosted card holds every dock occupant. */
    --chat-bubble-radius: calc(16 * var(--chat-unit));
    --chat-card-radius: calc(16 * var(--chat-unit));
    --chat-card-background: color-mix(in srgb, var(--planeai-surface) 92%, transparent);
    --chat-card-blur: blur(12px) saturate(1.14);
    --chat-card-shadow: 0 0 0 1px color-mix(in srgb, var(--planeai-text) 9%, transparent), 0 1px 2px rgb(0 0 0 / 5%), 0 8px 24px -12px rgb(0 0 0 / 12%);
    --chat-card-shadow-focus: 0 0 0 1px color-mix(in srgb, var(--planeai-text) 22%, transparent), 0 1px 2px rgb(0 0 0 / 5%), 0 8px 24px -12px rgb(0 0 0 / 16%);
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: var(--chat-font);
    font-size: var(--chat-size);
  }
  /* PlaneAI's baseline sizes these in px; as element rules after it, these keep its sizes at the default and scale them. */
  :global(p) { font-size: inherit; line-height: var(--chat-line-text); }
  :global(:is(button, input, select, textarea)) { line-height: var(--chat-line); }
  /* PlaneAI's baseline sizes controls in px too; :where keeps these below every component's own rules. */
  :where(.chat) :global(:is(button, input, select, textarea)) { border-radius: var(--chat-radius); }
  :where(.chat) :global(button) { min-height: calc(32 * var(--chat-unit)); padding: calc(6 * var(--chat-unit)) calc(10 * var(--chat-unit)); }
  /* WebKit frames never show native title tooltips, so controls labelled by an icon or a short name get this one. */
  :where(.chat) :global([data-tip]) { position: relative; }
  :where(.chat) :global([data-tip]::after) { content: attr(data-tip); position: absolute; bottom: calc(100% + calc(6 * var(--chat-unit))); left: 50%; z-index: 3; transform: translateX(-50%); padding: var(--chat-space-1) var(--chat-space-2); border-radius: var(--chat-radius-sm); background: var(--planeai-text); color: var(--planeai-main); font-family: var(--chat-font); font-size: var(--chat-size-xs); font-weight: 400; line-height: var(--chat-line); text-align: left; white-space: pre; pointer-events: none; opacity: 0; transition: opacity 120ms; }
  :where(.chat) :global([data-tip-end]::after) { right: 0; left: auto; transform: none; }
  :where(.chat) :global([data-tip]:hover::after) { opacity: 1; transition-delay: 400ms; }
  :where(.chat) :global([data-tip]:focus-visible::after) { opacity: 1; }
  :where(.chat) :global(:is(input, select)) { padding: calc(7 * var(--chat-unit)) calc(9 * var(--chat-unit)); }
  .log { flex: 1; overflow-y: auto; }
  .log::-webkit-scrollbar { width: 6px; }
  .log::-webkit-scrollbar-thumb { border-radius: 3px; background: var(--planeai-border-strong); }
  .empty { margin: 30vh var(--chat-space-5) 0; text-align: center; color: var(--planeai-text-subtle); }
  .body { display: flex; flex-direction: column; gap: var(--chat-space-3); padding: var(--chat-space-4) var(--chat-gutter) var(--chat-space-2); }
  .message { max-width: 100%; }
  .work summary { display: flex; align-items: center; gap: calc(6 * var(--chat-unit)); padding: calc(6 * var(--chat-unit)) 0; border-bottom: 1px solid color-mix(in srgb, var(--planeai-border-strong) 60%, transparent); color: var(--planeai-text-muted); font-size: var(--chat-size); cursor: pointer; list-style: none; }
  .work summary:hover { color: var(--planeai-text); }
  .work summary::-webkit-details-marker { display: none; }
  .work summary :global(.icon) { transition: transform 120ms; }
  .work[open] summary :global(.icon) { transform: rotate(90deg); }
  .steps { overflow: hidden; color: var(--planeai-text-subtle); text-overflow: ellipsis; white-space: nowrap; }
  .folded { display: flex; flex-direction: column; gap: var(--chat-space-3); margin-top: var(--chat-space-2); }
  .turn-summary { align-self: flex-end; color: var(--planeai-text-subtle); font-size: var(--chat-size-2xs); font-variant-numeric: tabular-nums; }
  .failed, .error { color: var(--planeai-danger); }
  .turn-summary.failed { align-self: stretch; }
  .working { width: fit-content; background: linear-gradient(90deg, var(--planeai-text-subtle) 0 40%, var(--planeai-text) 50%, var(--planeai-text-subtle) 60% 100%) 0 0 / 300% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; font-size: var(--chat-size-code); animation: shine 2.2s steps(30) infinite; }
  @media (prefers-reduced-motion: reduce) {
    .working { background: none; color: var(--planeai-text-subtle); animation: none; }
  }
  .divider { display: flex; align-items: center; gap: var(--chat-space-3); color: var(--planeai-text-subtle); font-size: var(--chat-size-xs); }
  .divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: var(--planeai-border-strong); }
  .notice { color: var(--planeai-text-subtle); font-size: var(--chat-size-xs); }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  /* The dock floats over the end of the log, which scrolls under its fade; only its card takes the pointer. */
  .dock { position: absolute; right: 0; bottom: 0; left: 0; padding: var(--chat-space-6) var(--chat-gutter) var(--chat-space-4); background: linear-gradient(to bottom, transparent, var(--planeai-main) 70%); pointer-events: none; }
  .dock > :global(*) { pointer-events: auto; }
  .composer, .handed-off { position: relative; border-radius: var(--chat-card-radius); background: var(--chat-card-background); -webkit-backdrop-filter: var(--chat-card-blur); backdrop-filter: var(--chat-card-blur); box-shadow: var(--chat-card-shadow); }
  .composer:focus-within { box-shadow: var(--chat-card-shadow-focus); }
  textarea { display: block; width: 100%; min-height: calc(44 * var(--chat-unit)); max-height: calc(240 * var(--chat-unit)); padding: calc(14 * var(--chat-unit)) calc(16 * var(--chat-unit)) var(--chat-space-1); border: 0; background: transparent; resize: none; font-size: var(--chat-size-body); }
  textarea:focus-visible { outline: none; }
  .composer :global(.commands) { right: 0; left: 0; bottom: calc(100% + var(--chat-space-2)); }
  /* In a narrow pane at a large size the right-hand controls wrap before the chips cut their labels. */
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--chat-space-1); min-width: 0; padding: var(--chat-space-1) var(--chat-space-2) var(--chat-space-2); }
  /* A square control labelled by an icon. */
  :where(.chat) :global(.icon-control) { display: grid; flex: none; place-items: center; width: calc(28 * var(--chat-unit)); height: calc(28 * var(--chat-unit)); min-height: 0; padding: 0; }
  .round { width: calc(32 * var(--chat-unit)); height: calc(32 * var(--chat-unit)); border: 0; border-radius: 50%; }
  .round.primary { box-shadow: inset 0 1px 0 rgb(255 255 255 / 16%), 0 1px 2px rgb(0 0 0 / 10%); transition: transform 120ms; }
  .round.primary:hover:not(:disabled) { transform: scale(1.05); background: var(--planeai-accent); }
  /* Dimmed by color rather than opacity, which would fade its tooltip too. */
  .round.primary:disabled { opacity: 1; background: color-mix(in srgb, var(--planeai-text) 12%, transparent); color: color-mix(in srgb, var(--planeai-text) 45%, transparent); box-shadow: none; }
  .stop, .stop:hover:not(:disabled) { background: var(--planeai-danger); color: var(--planeai-main); }
  .asking { display: flex; align-items: center; gap: var(--chat-space-2); color: var(--planeai-text-muted); font-size: var(--chat-size-sm); }
  .asking-dot { flex: none; width: calc(8 * var(--chat-unit)); height: calc(8 * var(--chat-unit)); border-radius: 50%; background: var(--planeai-warning); }
  .follow-up { align-self: flex-end; max-width: 80%; padding: var(--chat-space-3); border-radius: var(--chat-bubble-radius); background: var(--planeai-surface-raised); }
  .follow-up-label { color: var(--planeai-text-subtle); font-size: var(--chat-size-xs); }
  .follow-up-text { white-space: pre-wrap; overflow-wrap: anywhere; }
  .handed-off { display: flex; align-items: center; gap: var(--chat-space-3); padding: var(--chat-space-3) var(--chat-space-4); }
  .handed-off p { flex: 1; color: var(--planeai-text-muted); }
  :where(.chat) :global(button.primary) { background: var(--planeai-accent); color: var(--planeai-on-accent); border-color: var(--planeai-accent); }
  @keyframes shine { from { background-position: 100% 0; } to { background-position: 0 0; } }
</style>
