<script lang="ts">
  import { renderMarkdown } from "./markdown";

  let { text, onLink }: { text: string; onLink: (url: string) => void } = $props();
  const html = $derived(renderMarkdown(text));

  // Links would otherwise navigate the sandboxed frame away from the chat.
  function onclick(event: MouseEvent): void {
    const anchor = (event.target as Element | null)?.closest("a");
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute("href");
    if (href && /^https?:/i.test(href)) onLink(href);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="markdown" {onclick}>{@html html}</div>

<style>
  .markdown { font-size: var(--chat-size-body); line-height: 1.6; overflow-wrap: anywhere; }
  .markdown :global(p), .markdown :global(ul), .markdown :global(ol), .markdown :global(pre), .markdown :global(table), .markdown :global(blockquote) { margin: 0 0 var(--chat-space-2); }
  .markdown :global(:last-child) { margin-bottom: 0; }
  /* Paragraphs keep the released chat's base size; lists and tables use the body size. */
  .markdown :global(p) { font-size: var(--chat-size); }
  .markdown :global(ul), .markdown :global(ol) { padding-left: var(--chat-space-5); }
  .markdown :global(h1), .markdown :global(h2), .markdown :global(h3) { margin: var(--chat-space-3) 0 var(--chat-space-2); font-size: var(--chat-size-heading); line-height: var(--chat-line-heading); }
  .markdown :global(a) { color: var(--planeai-accent); text-decoration: underline; text-underline-offset: calc(2 * var(--chat-unit)); }
  .markdown :global(code) { font-family: var(--chat-code-font); font-size: var(--chat-size-code); }
  .markdown :global(:not(pre) > code) { padding: 1px var(--chat-space-1); border-radius: calc(4 * var(--chat-unit)); background: var(--planeai-surface-raised); }
  .markdown :global(pre.code) { padding: var(--chat-space-3); border: 1px solid var(--planeai-border); border-radius: var(--chat-radius); background: var(--planeai-surface); overflow-x: auto; }
  .markdown :global(blockquote) { padding-left: var(--chat-space-3); border-left: 2px solid var(--planeai-border-strong); color: var(--planeai-text-muted); }
  .markdown :global(table) { border-collapse: collapse; }
  .markdown :global(th), .markdown :global(td) { padding: var(--chat-space-1) var(--chat-space-2); border: 1px solid var(--planeai-border); text-align: left; }
  .markdown :global(.hljs-keyword), .markdown :global(.hljs-built_in), .markdown :global(.hljs-selector-tag) { color: var(--planeai-accent); }
  .markdown :global(.hljs-string), .markdown :global(.hljs-attr), .markdown :global(.hljs-addition) { color: var(--planeai-success); }
  .markdown :global(.hljs-number), .markdown :global(.hljs-literal), .markdown :global(.hljs-type) { color: var(--planeai-warning); }
  .markdown :global(.hljs-comment), .markdown :global(.hljs-quote) { color: var(--planeai-text-subtle); font-style: italic; }
  .markdown :global(.hljs-title), .markdown :global(.hljs-section) { color: var(--planeai-text); font-weight: 600; }
  .markdown :global(.hljs-deletion) { color: var(--planeai-danger); }
</style>
