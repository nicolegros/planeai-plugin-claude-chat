<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import { appearanceStyle, normalizeAppearance } from "../src/appearance";
  import CommandMenu from "./CommandMenu.svelte";
  import { CommandCatalog, matchCommands } from "./commands.svelte";
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
  import type { Appearance, CommandOption, PermissionDecision, ProviderUiContext, Snapshot, StoredEvent } from "./host";
  import { Transcript } from "./transcript.svelte";

  let { context }: { context: ProviderUiContext } = $props();

  /** The provider prompt limit from PlaneAI's plugin guide, measured as JSON-escaped text. */
  const MAX_MESSAGE_BYTES = 48 * 1024;

  const transcript = new Transcript();
  /** Claude's questions take the composer's place until answered. */
  const pendingQuestion = $derived(transcript.entries.findLast((entry) => entry.kind === "question" && !entry.resolved));
  let appearance = $state<Appearance>({});
  let draft = $state("");
  /** Streaming text re-rendered as markdown at most once per frame, not once per delta. */
  let liveMarkdown = $state("");
  let log: HTMLElement | undefined = $state();
  let composer: HTMLTextAreaElement | undefined = $state();
  let unsubscribe: (() => void) | undefined;
  let stickToBottom = true;

  const status = $derived(transcript.status);
  const working = $derived(status === "busy" || status === "needs_attention");
  const sessionId = $derived(context.session.id);
  const conversation = $derived(turns(transcript.entries));
  const root = $derived(transcript.meta.cwd ?? undefined);

  const uid = $props.id();
  const MENU_ID = `${uid}-commands`;
  const commands = new CommandCatalog(async () => {
    const all: CommandOption[] = [];
    for (;;) {
      const page = await context.host.call<{ commands: CommandOption[]; more: boolean }>("claude.commands", { session_id: sessionId, offset: all.length });
      all.push(...page.commands);
      if (!page.more || page.commands.length === 0) return all;
    }
  });
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

  function apply(event: StoredEvent): void {
    if (event.payload.type === "commands_changed") commands.invalidate();
    if (event.payload.type === "appearance") appearance = event.payload.appearance;
    transcript.apply(event);
    void scrollToBottom();
  }

  async function scrollToBottom(): Promise<void> {
    if (!stickToBottom) return;
    await tick();
    if (log) log.scrollTop = log.scrollHeight;
  }

  function onScroll(): void {
    if (!log) return;
    stickToBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 32;
  }

  async function run(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (error) {
      context.host.data.notify(String(error));
    }
  }

  function send(): void {
    const text = draft.trim();
    if (!text) return;
    if (new TextEncoder().encode(JSON.stringify(text)).length > MAX_MESSAGE_BYTES) {
      context.host.data.notify(`This message is too long to send; keep it under ${MAX_MESSAGE_BYTES / 1024} KB.`);
      return;
    }
    draft = "";
    stickToBottom = true;
    void resizeComposer();
    void run(() => context.host.session.send(text));
  }

  function interrupt(): void {
    void run(() => context.host.session.interrupt());
  }

  function respond(requestId: string, decision: PermissionDecision, reason?: string): void {
    void run(() => context.host.call("claude.permission.respond", { session_id: sessionId, request_id: requestId, decision, ...(reason ? { reason } : {}) }));
  }

  function setMode(mode: string): void {
    void run(() => context.host.call("claude.mode.set", { session_id: sessionId, mode }));
  }

  function handoff(): void {
    void run(() => context.host.session.handoff());
  }

  function handback(): void {
    void run(() => context.host.session.handback());
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
    if (event.key === "Escape" && working) {
      event.preventDefault();
      interrupt();
    } else if (event.key.length === 1 && !(event.key === " " && target?.closest(PRESSABLE))) {
      focusInput();
    }
  }

  // Answering a question or returning from the terminal brings the message box back; typing goes there again.
  let hadPrompt = false;
  $effect(() => {
    const prompt = !!pendingQuestion || transcript.meta.handed_off;
    if (hadPrompt && !prompt) void tick().then(focusInput);
    hadPrompt = prompt;
  });

  function answerQuestion(requestId: string, answers: Record<string, string> | null): void {
    void run(() => context.host.call("claude.question.answer", { session_id: sessionId, request_id: requestId, ...(answers ? { answers } : {}) }));
  }

  function setModel(model: string | null): void {
    void run(() => context.host.call("claude.model.set", { session_id: sessionId, model }));
  }

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
    } else if (event.key === "Escape" && working) {
      event.preventDefault();
      interrupt();
    }
  }

  async function loadSnapshot(): Promise<void> {
    let after = 0;
    for (;;) {
      const page = await context.host.call<Snapshot>("claude.snapshot", { session_id: sessionId, ...(after ? { after_seq: after } : {}) });
      page.events.forEach((event) => transcript.apply(event));
      transcript.setMeta(page.meta);
      transcript.status = page.status;
      const last = page.events.at(-1);
      if (!page.more || !last) return;
      after = last.seq;
    }
  }

  onMount(() => {
    // Subscribe before the snapshot so nothing emitted in between is lost; seq drops duplicates.
    const buffered: StoredEvent[] = [];
    let replaying = true;
    unsubscribe = context.host.session.onEvent((event) => (replaying ? buffered.push(event) : apply(event)));
    void loadSnapshot()
      .catch((error) => context.host.data.notify(String(error)))
      .finally(() => {
        replaying = false;
        buffered.splice(0).forEach(apply);
        void scrollToBottom();
      });
    composer?.focus();
    // Without the settings, PlaneAI's own fonts apply.
    context.host.settings
      .get()
      .then((settings) => (appearance = normalizeAppearance(settings)))
      .catch(() => {});
  });

  onDestroy(() => unsubscribe?.());

  const openExternal = (url: string) => context.host.navigation.openExternal(url);
</script>

{#snippet block(item: Block)}
  {#if item.kind === "tools"}
    <ToolSteps tools={item.tools} {root} />
  {:else if item.entry.kind === "user"}
    <div class="follow-up"><p class="follow-up-label">Your follow-up</p><p class="follow-up-text">{item.entry.text}</p></div>
  {:else if item.entry.kind === "assistant"}
    <div class="message"><Markdown text={item.entry.text} onLink={openExternal} /></div>
  {:else if item.entry.kind === "question"}
    {#if item.entry.resolved}
      <QuestionAnswers questions={item.entry.questions} answers={item.entry.answers} />
    {:else}
      <p class="asking"><span class="asking-dot" aria-hidden="true"></span>Claude is asking {item.entry.questions.length === 1 ? "a question" : `${item.entry.questions.length} questions`} · answer below</p>
    {/if}
  {:else if item.entry.kind === "permission"}
    {@const permission = item.entry.permission}
    <PermissionCard {permission} onRespond={(decision, reason) => respond(permission.request_id, decision, reason)} />
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
    <div class="message"><Markdown text={liveMarkdown || transcript.live} onLink={openExternal} /></div>
  {:else if working}
    <p class="working" aria-hidden="true">{status === "needs_attention" ? "Waiting for your answer" : transcript.meta.compacting ? "Compacting the conversation" : "Claude is working"}<span class="ellipsis"></span></p>
  {/if}
{/snippet}

<svelte:window onfocus={onWindowFocus} onkeydown={onWindowKeydown} />

<main class="chat" style={appearanceStyle(appearance)}>
  <div class="log" bind:this={log} onscroll={onScroll} role="log" aria-label="Conversation" aria-busy={!!transcript.live}>
    {#if conversation.length === 0}
      {#if transcript.live || working}
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
  <p class="visually-hidden" role="status">{status === "needs_attention" ? "Claude is waiting for your answer" : working ? "Claude is working" : ""}</p>
  {#if pendingQuestion?.kind === "question" && !transcript.meta.handed_off}
    {@const question = pendingQuestion}
    <div class="dock">
      {#key question.request_id}<QuestionPrompt questions={question.questions} onAnswer={(answers) => answerQuestion(question.request_id, answers)} />{/key}
    </div>
  {:else if transcript.meta.handed_off}
    <div class="dock">
      <div class="handed-off" role="status">
        <p>This conversation is continuing in a terminal tab. Closing that tab brings it back here.</p>
        <button type="button" class="primary" onclick={handback}>Return to chat</button>
      </div>
    </div>
  {:else}
    <div class="dock">
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
          placeholder={working ? "Queue a follow-up · Esc to stop" : "Message Claude · / for commands"}
          aria-label="Message Claude"
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          aria-controls={menuOpen && matches.length > 0 ? MENU_ID : undefined}
          aria-activedescendant={menuOpen && matches.length > 0 ? `${MENU_ID}-${activeIndex}` : undefined}
        ></textarea>
        <div class="bar">
          <ComposerBar meta={transcript.meta} onMode={setMode} onModel={setModel} onHandoff={handoff}>
            {#snippet actions()}
              {#if working}
                <button type="button" class="icon-control round" onclick={interrupt} data-tip="Stop · Esc" data-tip-end aria-label="Stop"><Icon name="stop" size={12} /></button>
              {/if}
              <button type="submit" class="icon-control round primary" disabled={!draft.trim()} data-tip={working ? "Queue · Enter" : "Send · Enter"} data-tip-end aria-label={working ? "Queue" : "Send"}><Icon name="arrow-up" /></button>
            {/snippet}
          </ComposerBar>
        </div>
      </form>
    </div>
  {/if}
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
  .empty { margin: 30vh var(--chat-space-5) 0; text-align: center; color: var(--planeai-text-subtle); }
  .turn { border-bottom: 1px solid var(--planeai-border); }
  .turn:last-child { border-bottom: 0; }
  .body { display: flex; flex-direction: column; gap: var(--chat-space-3); padding: var(--chat-space-4) var(--chat-space-5) var(--chat-space-5); }
  .message { max-width: 100%; }
  .work summary { display: inline-flex; align-items: center; gap: calc(6 * var(--chat-unit)); max-width: 100%; padding: calc(2 * var(--chat-unit)) var(--chat-space-2) calc(2 * var(--chat-unit)) var(--chat-space-1); margin-left: calc(-4 * var(--chat-unit)); border-radius: var(--chat-radius-sm); color: var(--planeai-text-muted); font-size: var(--chat-size-sm); cursor: pointer; list-style: none; }
  .work summary:hover { background: var(--planeai-accent-subtle); color: var(--planeai-text); }
  .work summary::-webkit-details-marker { display: none; }
  .work summary :global(.icon) { transition: transform 120ms; }
  .work[open] summary :global(.icon) { transform: rotate(90deg); }
  .steps { overflow: hidden; color: var(--planeai-text-subtle); text-overflow: ellipsis; white-space: nowrap; }
  .folded { display: flex; flex-direction: column; gap: var(--chat-space-3); margin: var(--chat-space-2) 0 0 calc(5 * var(--chat-unit)); padding-left: var(--chat-space-4); border-left: 1px solid var(--planeai-border-strong); }
  .turn-summary { align-self: flex-end; color: var(--planeai-text-subtle); font-size: var(--chat-size-xs); font-variant-numeric: tabular-nums; }
  .failed, .error { color: var(--planeai-danger); }
  .turn-summary.failed { align-self: stretch; }
  .working { color: var(--planeai-text-subtle); font-size: var(--chat-size-code); }
  .divider { display: flex; align-items: center; gap: var(--chat-space-3); color: var(--planeai-text-subtle); font-size: var(--chat-size-xs); }
  .divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: var(--planeai-border-strong); }
  .notice { color: var(--planeai-text-subtle); font-size: var(--chat-size-xs); }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .ellipsis::after { content: "…"; animation: blink 1.4s steps(4, end) infinite; }
  .dock { padding: var(--chat-space-3) var(--chat-space-5) var(--chat-space-4); border-top: 1px solid var(--planeai-border); }
  .composer, .handed-off { position: relative; border: 1px solid var(--planeai-border-strong); border-radius: calc(12 * var(--chat-unit)); background: var(--planeai-surface); }
  .composer:focus-within { border-color: color-mix(in srgb, var(--planeai-text) 32%, transparent); }
  textarea { display: block; width: 100%; min-height: calc(44 * var(--chat-unit)); max-height: calc(240 * var(--chat-unit)); padding: var(--chat-space-3) var(--chat-space-3) var(--chat-space-1); border: 0; background: transparent; resize: none; font-size: var(--chat-size-body); }
  textarea:focus-visible { outline: none; }
  .composer :global(.commands) { right: 0; left: 0; bottom: calc(100% + var(--chat-space-2)); }
  /* In a narrow pane at a large size the right-hand controls wrap rather than cut the model name. */
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--chat-space-1); min-width: 0; padding: var(--chat-space-1) var(--chat-space-2) var(--chat-space-2); }
  /* A square control labelled by an icon. */
  :where(.chat) :global(.icon-control) { display: grid; flex: none; place-items: center; width: calc(28 * var(--chat-unit)); height: calc(28 * var(--chat-unit)); min-height: 0; padding: 0; }
  .round { border-radius: 50%; }
  .asking { display: flex; align-items: center; gap: var(--chat-space-2); color: var(--planeai-text-muted); font-size: var(--chat-size-sm); }
  .asking-dot { flex: none; width: calc(8 * var(--chat-unit)); height: calc(8 * var(--chat-unit)); border-radius: 50%; background: var(--planeai-warning); }
  .follow-up { align-self: flex-end; max-width: 85%; padding: var(--chat-space-2) var(--chat-space-3); border-radius: var(--chat-radius); background: var(--planeai-accent-subtle); }
  .follow-up-label { color: var(--planeai-text-subtle); font-size: var(--chat-size-xs); }
  .follow-up-text { white-space: pre-wrap; overflow-wrap: anywhere; }
  /* Dimmed by color rather than opacity, which would fade its tooltip too. */
  .round.primary:disabled { opacity: 1; border-color: transparent; background: color-mix(in srgb, var(--planeai-accent) 30%, var(--planeai-surface)); }
  .handed-off { display: flex; align-items: center; gap: var(--chat-space-3); padding: var(--chat-space-3) var(--chat-space-4); }
  .handed-off p { flex: 1; color: var(--planeai-text-muted); }
  :where(.chat) :global(button.primary) { background: var(--planeai-accent); color: var(--planeai-on-accent); border-color: var(--planeai-accent); }
  @keyframes blink { 0% { opacity: 0.2; } 50% { opacity: 1; } 100% { opacity: 0.2; } }
</style>
