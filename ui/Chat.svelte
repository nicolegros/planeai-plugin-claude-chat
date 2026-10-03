<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import CommandMenu from "./CommandMenu.svelte";
  import { CommandCatalog, matchCommands } from "./commands.svelte";
  import Header from "./Header.svelte";
  import Markdown from "./Markdown.svelte";
  import PermissionCard from "./PermissionCard.svelte";
  import ToolCard from "./ToolCard.svelte";
  import type { CommandOption, Compaction, PermissionDecision, ProviderUiContext, Snapshot, StoredEvent, TokenUsage } from "./host";
  import { Transcript } from "./transcript.svelte";

  let { context }: { context: ProviderUiContext } = $props();

  /** The provider prompt limit from PlaneAI's plugin guide, measured as JSON-escaped text. */
  const MAX_MESSAGE_BYTES = 48 * 1024;

  const transcript = new Transcript();
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

  function setModel(model: string | null): void {
    void run(() => context.host.call("claude.model.set", { session_id: sessionId, model }));
  }

  async function resizeComposer(): Promise<void> {
    await tick();
    if (!composer) return;
    composer.style.height = "auto";
    composer.style.height = `${Math.min(composer.scrollHeight, 240)}px`;
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
  });

  onDestroy(() => unsubscribe?.());

  const openExternal = (url: string) => context.host.navigation.openExternal(url);

  function seconds(ms: number): string {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function turnSummary(entry: { is_error: boolean; text?: string; duration_ms: number; cost_usd: number; usage?: TokenUsage }): string {
    return [entry.is_error ? (entry.text ?? "Turn failed") : null, seconds(entry.duration_ms), `$${entry.cost_usd.toFixed(4)}`, entry.usage ? tokens(entry.usage) : null]
      .filter(Boolean)
      .join(" · ");
  }

  function short(count: number): string {
    return count >= 1000 ? `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(count);
  }

  function tokens(usage: TokenUsage): string {
    const input = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens;
    return `${short(input)} in · ${short(usage.output_tokens)} out`;
  }

  function compacted(entry: Compaction): string {
    const what = entry.trigger === "auto" ? "Conversation compacted automatically" : "Conversation compacted";
    const detail = entry.post_tokens === undefined ? `${short(entry.pre_tokens)} tokens summarized` : `${short(entry.pre_tokens)} → ${short(entry.post_tokens)} tokens`;
    return `${what} · ${detail}`;
  }
</script>

<main class="chat">
  <Header meta={transcript.meta} onMode={setMode} onModel={setModel} onHandoff={handoff} />
  <div class="log" bind:this={log} onscroll={onScroll} role="log" aria-label="Conversation" aria-busy={!!transcript.live}>
    {#if transcript.entries.length === 0 && !transcript.live}
      <p class="empty">Send a message to start Claude in this worktree, or type / for commands.</p>
    {/if}
    {#each transcript.entries as entry (entry.seq)}
      {#if entry.kind === "user"}
        <div class="message user"><p class="text">{entry.text}</p></div>
      {:else if entry.kind === "assistant"}
        <div class="message assistant"><Markdown text={entry.text} onLink={openExternal} /></div>
      {:else if entry.kind === "tool"}
        <ToolCard name={entry.name} summary={entry.summary} input={entry.input} result={entry.result} />
      {:else if entry.kind === "permission"}
        <PermissionCard permission={entry.permission} onRespond={(decision, reason) => respond(entry.permission.request_id, decision, reason)} />
      {:else if entry.kind === "result"}
        <p class="turn" class:failed={entry.is_error}>{turnSummary(entry)}</p>
      {:else if entry.kind === "error"}
        <p class="error">{entry.message}</p>
      {:else if entry.kind === "handoff"}
        <p class="divider">{entry.in_terminal ? "Continued in the terminal" : "Back in the chat. Turns taken in the terminal are in Claude's history but not shown here."}</p>
      {:else if entry.kind === "compacted"}
        <p class="divider">{compacted(entry)}</p>
      {:else if entry.kind === "cleared"}
        <p class="divider">Context cleared · Claude no longer sees the messages above</p>
      {:else if entry.kind === "notice"}
        <p class="notice">{entry.text}</p>
      {/if}
    {/each}
    {#if transcript.live}
      <div class="message assistant"><Markdown text={liveMarkdown || transcript.live} onLink={openExternal} /></div>
    {:else if working}
      <p class="working" aria-hidden="true">{status === "needs_attention" ? "Waiting for your answer" : transcript.meta.compacting ? "Compacting the conversation" : "Claude is working"}<span class="ellipsis"></span></p>
    {/if}
  </div>
  <p class="visually-hidden" role="status">{status === "needs_attention" ? "Claude is waiting for your answer" : working ? "Claude is working" : ""}</p>
  {#if transcript.meta.handed_off}
    <div class="handed-off" role="status">
      <p>This conversation is continuing in a terminal tab. Closing that tab brings it back here.</p>
      <button type="button" class="primary" onclick={handback}>Return to chat</button>
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
      placeholder={working ? "Queue a follow-up · Esc to stop" : "Message Claude · Enter to send, Shift+Enter for a new line"}
      aria-label="Message Claude"
      role="combobox"
      aria-autocomplete="list"
      aria-haspopup="listbox"
      aria-expanded={menuOpen}
      aria-controls={menuOpen && matches.length > 0 ? MENU_ID : undefined}
      aria-activedescendant={menuOpen && matches.length > 0 ? `${MENU_ID}-${activeIndex}` : undefined}
    ></textarea>
    {#if working}
      <button type="button" onclick={interrupt}>Stop</button>
    {/if}
    <button type="submit" class="primary" disabled={!draft.trim()}>{working ? "Queue" : "Send"}</button>
  </form>
  {/if}
</main>

<style>
  .chat { display: flex; flex-direction: column; height: 100vh; }
  .log { flex: 1; overflow-y: auto; padding: var(--planeai-space-4); display: flex; flex-direction: column; gap: var(--planeai-space-3); }
  .empty { margin: auto; color: var(--planeai-text-subtle); }
  .message.user { align-self: flex-end; max-width: 80%; padding: var(--planeai-space-2) var(--planeai-space-3); border-radius: var(--planeai-radius); background: var(--planeai-accent-subtle); }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13.5px; line-height: 1.55; }
  .message.assistant { max-width: 100%; }
  .turn { color: var(--planeai-text-subtle); font-size: 11.5px; font-variant-numeric: tabular-nums; }
  .failed, .error { color: var(--planeai-danger); }
  .working { color: var(--planeai-text-subtle); font-size: 12.5px; }
  .divider { display: flex; align-items: center; gap: var(--planeai-space-2); color: var(--planeai-text-subtle); font-size: 11.5px; }
  .divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: var(--planeai-border); }
  .handed-off { display: flex; align-items: center; gap: var(--planeai-space-3); padding: var(--planeai-space-3) var(--planeai-space-4); border-top: 1px solid var(--planeai-border); background: var(--planeai-surface); }
  .handed-off p { flex: 1; color: var(--planeai-text-muted); }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .ellipsis::after { content: "…"; animation: blink 1.4s steps(4, end) infinite; }
  .notice { color: var(--planeai-text-subtle); font-size: 11.5px; }
  .composer { position: relative; display: flex; gap: var(--planeai-space-2); align-items: flex-end; padding: var(--planeai-space-3) var(--planeai-space-4); border-top: 1px solid var(--planeai-border); }
  textarea { flex: 1; resize: none; min-height: 34px; max-height: 240px; line-height: 18px; }
  button.primary { background: var(--planeai-accent); color: var(--planeai-on-accent); border-color: var(--planeai-accent); }
  @keyframes blink { 0% { opacity: 0.2; } 50% { opacity: 1; } 100% { opacity: 0.2; } }
</style>
