<script lang="ts">
  import type { Todo } from "./host";

  let { todos }: { todos: Todo[] } = $props();
  const LABELS: Record<Todo["status"], string> = { completed: "Done", in_progress: "In progress", pending: "To do" };
</script>

<ul class="checklist">
  {#each todos as todo, index (index)}
    <li data-status={todo.status}>
      <span class="box" role="img" aria-label={LABELS[todo.status]}>
        {#if todo.status === "completed"}<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>{/if}
      </span>
      <span class="text">{todo.content}</span>
    </li>
  {/each}
</ul>

<style>
  .checklist { display: grid; gap: var(--chat-space-1); margin: 0; padding: 0; list-style: none; font-size: var(--chat-size-sm); }
  li { display: flex; align-items: flex-start; gap: var(--chat-space-2); line-height: var(--chat-line); }
  .box { display: grid; place-items: center; flex: none; width: calc(14 * var(--chat-unit)); height: calc(14 * var(--chat-unit)); margin-top: calc((var(--chat-line) - calc(14 * var(--chat-unit))) / 2); border: 1.5px solid var(--planeai-border-strong); border-radius: calc(4 * var(--chat-unit)); }
  .check { width: calc(10 * var(--chat-unit)); height: calc(10 * var(--chat-unit)); }
  [data-status="completed"] .box { border-color: var(--planeai-success); background: var(--planeai-success); color: var(--planeai-main); }
  [data-status="completed"] .text { color: var(--planeai-text-subtle); text-decoration: line-through; }
  [data-status="in_progress"] .box { border-color: var(--planeai-text); }
  [data-status="in_progress"] .text { font-weight: 600; }
  [data-status="pending"] .text { color: var(--planeai-text-muted); }
</style>
