<script lang="ts">
  import { backgroundTitle } from "./background";
  import { clock } from "./clock.svelte";
  import { duration } from "./format";
  import type { BackgroundTask } from "./host";
  import Icon from "./Icon.svelte";

  let { tasks, onStop }: { tasks: BackgroundTask[]; onStop: () => Promise<boolean> } = $props();

  /** Set until the stopped work leaves the list, which changes with each task that stops. */
  let stopping = $state<BackgroundTask[] | null>(null);
  const since = $derived(Math.min(...tasks.map((task) => task.started_at)));

  $effect(() => clock.hold());

  async function stop(): Promise<void> {
    stopping = tasks;
    if (!(await onStop())) stopping = null;
  }
</script>

<div class="background">
  <span class="icon"><Icon name={tasks.some((task) => task.kind === "agent") ? "bot" : "terminal"} size={14} /></span>
  <!-- The chat's own status line announces what runs, and not the time ticking here. -->
  <span class="title">{backgroundTitle(tasks)}</span>
  <span class="elapsed" aria-hidden="true">{duration(Math.max(0, clock.now - since))}</span>
  <button type="button" class="stop" onclick={stop} disabled={stopping === tasks} aria-label={stopping === tasks ? "Stopping background work" : "Stop background work"}>{stopping === tasks ? "Stopping…" : "Stop"}</button>
</div>

<style>
  .background { display: flex; align-items: center; gap: var(--chat-space-2); min-width: 0; margin-bottom: var(--chat-space-2); padding: calc(6 * var(--chat-unit)) calc(6 * var(--chat-unit)) calc(6 * var(--chat-unit)) var(--chat-space-3); border-radius: var(--chat-radius); background: var(--chat-card-background); -webkit-backdrop-filter: var(--chat-card-blur); backdrop-filter: var(--chat-card-blur); box-shadow: var(--chat-card-shadow); color: var(--planeai-text-muted); font-size: var(--chat-size-sm); }
  .icon { display: grid; flex: none; place-items: center; color: var(--planeai-text-subtle); }
  .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .elapsed { flex: none; color: var(--planeai-text-subtle); font-size: var(--chat-size-xs); font-variant-numeric: tabular-nums; }
  .stop { flex: none; min-height: calc(24 * var(--chat-unit)); padding: 0 var(--chat-space-2); font-size: var(--chat-size-xs); }
</style>
