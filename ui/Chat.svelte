<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import type { ProviderUiContext, Snapshot, StoredEvent } from "./host";
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

  function apply(event: StoredEvent): void {
    transcript.apply(event);
    if (event.payload && typeof event.payload === "object") {
      const type = (event.payload as { type?: string }).type;
      if (type === "user" || type === "delta" || type === "tool" || type === "permission_resolved") status = "busy";
      if (type === "permission") status = "needs_attention";
      if (type === "result" || type === "error") status = "idle";
    }
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

  async function send(): Promise<void> {
    const text = draft.trim();
    if (!text) return;
    draft = "";
    stickToBottom = true;
    try {
      await context.host.session.send(text);
    } catch (error) {
      context.host.data.notify(String(error));
    }
  }

  async function interrupt(): Promise<void> {
    try {
      await context.host.session.interrupt();
    } catch (error) {
      context.host.data.notify(String(error));
    }
  }

  async function respond(requestId: string, allow: boolean): Promise<void> {
    try {
      await context.host.call("claude.permission.respond", { session_id: context.session.id, request_id: requestId, allow });
    } catch (error) {
      context.host.data.notify(String(error));
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void send();
    } else if (event.key === "Escape" && working) {
      event.preventDefault();
      void interrupt();
    }
  }

  onMount(() => {
    // Subscribe before the snapshot so nothing emitted in between is lost; seq drops duplicates.
    const buffered: StoredEvent[] = [];
    let replaying = true;
    unsubscribe = context.host.session.onEvent((event) => (replaying ? buffered.push(event) : apply(event)));
    void context.host
      .call<Snapshot>("claude.snapshot", { session_id: context.session.id })
      .then((snapshot) => {
        snapshot.events.forEach((event) => transcript.apply(event));
        status = snapshot.status;
      })
      .catch((error) => context.host.data.notify(String(error)))
      .finally(() => {
        replaying = false;
        buffered.splice(0).forEach(apply);
        void scrollToBottom();
      });
    composer?.focus();
  });

  onDestroy(() => unsubscribe?.());

  function seconds(ms: number): string {
    return `${(ms / 1000).toFixed(1)}s`;
  }
</script>

<main class="chat">
  <div class="log" bind:this={log} onscroll={onScroll} aria-live="polite">
    {#if transcript.entries.length === 0 && !transcript.live}
      <p class="empty">Send a message to start Claude in this worktree.</p>
    {/if}
    {#each transcript.entries as entry (entry.seq)}
      {#if entry.kind === "user"}
        <div class="entry user"><span class="role">You</span><pre>{entry.text}</pre></div>
      {:else if entry.kind === "assistant"}
        <div class="entry assistant"><span class="role">Claude</span><pre>{entry.text}</pre></div>
      {:else if entry.kind === "tool"}
        <div class="entry tool">
          <pre><span class="tool-name">{entry.name}</span> {entry.summary}</pre>
          {#if entry.result}
            <pre class="tool-result" class:failed={entry.result.is_error}>{entry.result.summary || (entry.result.is_error ? "failed" : "done")}</pre>
          {/if}
        </div>
      {:else if entry.kind === "permission"}
        <div class="entry permission" data-permission={entry.permission.request_id}>
          <p>{entry.permission.title}</p>
          <pre>{entry.permission.summary}</pre>
          {#if entry.permission.resolved === null}
            <div class="actions">
              <button type="button" class="primary" onclick={() => respond(entry.permission.request_id, true)}>Allow</button>
              <button type="button" onclick={() => respond(entry.permission.request_id, false)}>Deny</button>
            </div>
          {:else}
            <p class="resolution">{entry.permission.resolved ? "Allowed" : "Denied"}</p>
          {/if}
        </div>
      {:else if entry.kind === "result"}
        <p class="entry result" class:failed={entry.is_error}>
          {entry.is_error ? (entry.text ?? "Turn failed") : "Done"} · {seconds(entry.duration_ms)} · ${entry.cost_usd.toFixed(4)}
        </p>
      {:else if entry.kind === "error"}
        <p class="entry error" role="alert">{entry.message}</p>
      {/if}
    {/each}
    {#if transcript.live}
      <div class="entry assistant"><span class="role">Claude</span><pre>{transcript.live}</pre></div>
    {/if}
  </div>
  <form class="composer" onsubmit={(event) => { event.preventDefault(); void send(); }}>
    <textarea
      bind:this={composer}
      bind:value={draft}
      onkeydown={onKeydown}
      rows="3"
      placeholder={working ? "Claude is working… (Esc to interrupt)" : "Message Claude (Enter to send, Shift+Enter for a new line)"}
      aria-label="Message Claude"
    ></textarea>
    {#if working}
      <button type="button" onclick={interrupt}>Stop</button>
    {:else}
      <button type="submit" class="primary" disabled={!draft.trim()}>Send</button>
    {/if}
  </form>
</main>

<style>
  .chat { display: flex; flex-direction: column; height: 100vh; }
  .log { flex: 1; overflow-y: auto; padding: var(--planeai-space-4); display: flex; flex-direction: column; gap: var(--planeai-space-3); }
  .empty { margin: auto; color: var(--planeai-text-subtle); }
  .entry { display: flex; flex-direction: column; gap: var(--planeai-space-1); }
  .role { font-size: 11px; font-weight: 600; color: var(--planeai-text-subtle); text-transform: uppercase; letter-spacing: 0.04em; }
  pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: var(--planeai-font-mono); font-size: 12.5px; line-height: 1.5; }
  .user pre { color: var(--planeai-text-muted); }
  .tool pre { color: var(--planeai-text-muted); }
  .tool-name { color: var(--planeai-accent); font-weight: 600; }
  .tool-result { padding-left: var(--planeai-space-3); border-left: 2px solid var(--planeai-border); max-height: 160px; overflow: hidden; }
  .failed { color: var(--planeai-danger); }
  .permission { padding: var(--planeai-space-3); border: 1px solid var(--planeai-warning); border-radius: var(--planeai-radius); background: var(--planeai-surface); }
  .actions { display: flex; gap: var(--planeai-space-2); margin-top: var(--planeai-space-2); }
  .resolution, .result { color: var(--planeai-text-subtle); font-size: 12px; }
  .error { color: var(--planeai-danger); }
  .composer { display: flex; gap: var(--planeai-space-2); align-items: flex-end; padding: var(--planeai-space-3) var(--planeai-space-4); border-top: 1px solid var(--planeai-border); }
  textarea { flex: 1; resize: none; min-height: 0; }
  button.primary { background: var(--planeai-accent); color: var(--planeai-on-accent); border-color: var(--planeai-accent); }
</style>
