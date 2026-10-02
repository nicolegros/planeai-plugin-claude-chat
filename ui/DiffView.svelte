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
  .diff { margin: 0; max-height: 320px; overflow: auto; font-family: var(--planeai-font-mono); font-size: 12px; line-height: 1.5; border: 1px solid var(--planeai-border); border-radius: var(--planeai-radius); background: var(--planeai-surface); }
  .line { display: block; padding: 0 var(--planeai-space-3) 0 var(--planeai-space-2); white-space: pre; }
  .marker { display: inline-block; width: 14px; color: var(--planeai-text-subtle); user-select: none; }
  .add { background: color-mix(in srgb, var(--planeai-success) 14%, transparent); }
  .remove { background: color-mix(in srgb, var(--planeai-danger) 14%, transparent); }
</style>
