<script lang="ts">
  import { diffLines } from "diff";

  let { before, after }: { before: string; after: string } = $props();

  interface Line {
    kind: "add" | "remove" | "same";
    text: string;
  }

  const lines = $derived(
    diffLines(before, after).flatMap((part): Line[] => {
      const kind = part.added ? "add" : part.removed ? "remove" : "same";
      return part.value.replace(/\n$/, "").split("\n").map((text) => ({ kind, text }));
    }),
  );
</script>

<pre class="diff">{#each lines as line, index (index)}<span class="line {line.kind}"><span class="marker">{line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}</span>{line.text}
</span>{/each}</pre>

<style>
  .diff { margin: 0; max-height: calc(320 * var(--chat-unit)); overflow: auto; font-family: var(--chat-code-font); font-size: var(--chat-size-sm); line-height: 1.5; border: 1px solid var(--planeai-border); border-radius: var(--chat-radius); background: var(--planeai-surface); }
  .line { display: block; padding: 0 var(--chat-space-3) 0 var(--chat-space-2); white-space: pre; }
  .marker { display: inline-block; width: calc(14 * var(--chat-unit)); color: var(--planeai-text-subtle); user-select: none; }
  .add { background: color-mix(in srgb, var(--planeai-success) 14%, transparent); }
  .remove { background: color-mix(in srgb, var(--planeai-danger) 14%, transparent); }
</style>
