<script lang="ts">
  import type { Question } from "./host";

  /** `answers` is null when the user skipped, or Claude stopped before an answer. */
  let { questions, answers }: { questions: Question[]; answers: Record<string, string> | null } = $props();
</script>

<div class="answers">
  {#if answers}
    {#each questions as question (question.question)}
      <p class="line">
        {#if question.header}<span class="chip">{question.header}</span>{/if}
        <span class="question">{question.question}</span>
        <span class="answer">{answers[question.question] || "No answer"}</span>
      </p>
    {/each}
  {:else}
    <p class="line"><span class="chip">Skipped</span><span class="question">{questions.length === 1 ? questions[0].question : `${questions.length} questions from Claude`}</span></p>
  {/if}
</div>

<style>
  .answers { display: grid; gap: var(--chat-space-1); }
  .line { display: flex; align-items: baseline; gap: var(--chat-space-2); min-width: 0; font-size: var(--chat-size-sm); }
  .chip { flex: none; padding: 0 var(--chat-space-2); border-radius: var(--chat-radius-sm); background: var(--planeai-surface-raised); color: var(--planeai-text-muted); font-size: var(--chat-size-xs); }
  .question { min-width: 0; overflow: hidden; color: var(--planeai-text-muted); text-overflow: ellipsis; white-space: nowrap; }
  .answer { flex: none; max-width: 50%; margin-left: auto; overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
</style>
