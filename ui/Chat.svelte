<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import Header from "./Header.svelte";
  import Markdown from "./Markdown.svelte";
  import PermissionCard from "./PermissionCard.svelte";
  import ToolCard from "./ToolCard.svelte";
  import type { ProviderUiContext, Snapshot, StoredEvent, TokenUsage } from "./host";
  import { Transcript } from "./transcript.svelte";

  let { context }: { context: ProviderUiContext } = $props();

  const transcript = new Transcript();
  let status = $state<Snapshot["status"]>("idle");
  let draft = $state("");
  let log: HTMLElement | undefined = $state();
  let composer: HTMLTextAreaElement | undefined = $state();
  let unsubscribe: (() => void) | undefined;
  let stickToBottom = true;

  const working = $derived(status === "busy" || status === "needs_attention");
  const sessionId = $derived(context.session.id);

  function apply(event: StoredEvent): void {
    transcript.apply(event);
    const type = (event.payload as { type?: string }).type;
    if (type === "user" || type === "delta" || type === "tool" || type === "permission_resolved") status = "busy";
    if (type === "permission") status = "needs_attention";
    if (type === "result" || type === "error") status = "idle";
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
    draft = "";
    stickToBottom = true;
    void resizeComposer();
    void run(() => context.host.session.send(text));
  }

  function interrupt(): void {
    void run(() => context.host.session.interrupt());
  }

  function respond(requestId: string, decision: "allow" | "allow_session" | "deny", reason?: string): void {
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

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
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
      if (page.meta) transcript.setMeta(page.meta);
      status = page.status;
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

  function tokens(usage: TokenUsage): string {
    const input = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens;
    const short = (count: number) => (count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count));
    return `${short(input)} in · ${short(usage.output_tokens)} out`;
  }
</script>

<main class="chat">
  <Header meta={transcript.meta} onMode={setMode} onModel={setModel} onHandoff={handoff} />
  <div class="log" bind:this={log} onscroll={onScroll} aria-live="polite">
    {#if transcript.entries.length === 0 && !transcript.live}
      <p class="empty">Send a message to start Claude in this worktree.</p>
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
        <p class="error" role="alert">{entry.message}</p>
      {:else if entry.kind === "handoff"}
        <p class="divider">{entry.in_terminal ? "Continued in the terminal" : "Back in the chat. Turns taken in the terminal are in Claude's history but not shown here."}</p>
      {/if}
    {/each}
    {#if transcript.live}
      <div class="message assistant"><Markdown text={transcript.live} onLink={openExternal} /></div>
    {:else if working}
      <p class="working">{status === "needs_attention" ? "Waiting for your answer" : "Claude is working"}<span class="ellipsis" aria-hidden="true"></span></p>
    {/if}
  </div>
  {#if transcript.meta.handed_off}
    <div class="handed-off" role="status">
      <p>This conversation is continuing in a terminal tab. Closing that tab brings it back here.</p>
      <button type="button" class="primary" onclick={handback}>Return to chat</button>
    </div>
  {:else}
  <form class="composer" onsubmit={(event) => { event.preventDefault(); send(); }}>
    <textarea
      bind:this={composer}
      bind:value={draft}
      oninput={resizeComposer}
      onkeydown={onKeydown}
      rows="1"
      placeholder={working ? "Queue a follow-up · Esc to stop" : "Message Claude · Enter to send, Shift+Enter for a new line"}
      aria-label="Message Claude"
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
  .ellipsis::after { content: "…"; animation: blink 1.4s steps(4, end) infinite; }
  .composer { display: flex; gap: var(--planeai-space-2); align-items: flex-end; padding: var(--planeai-space-3) var(--planeai-space-4); border-top: 1px solid var(--planeai-border); }
  textarea { flex: 1; resize: none; min-height: 34px; max-height: 240px; line-height: 18px; }
  button.primary { background: var(--planeai-accent); color: var(--planeai-on-accent); border-color: var(--planeai-accent); }
  @keyframes blink { 0% { opacity: 0.2; } 50% { opacity: 1; } 100% { opacity: 0.2; } }
</style>
