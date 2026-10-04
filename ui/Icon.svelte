<script lang="ts">
  import { ICONS, type IconName } from "./icons";

  let { name, size = 14 }: { name: IconName; size?: number } = $props();
</script>

<svg class="icon" style:width="calc({size} * var(--chat-unit, 1px))" style:height="calc({size} * var(--chat-unit, 1px))" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#each ICONS[name] as d (d)}<path {d} />{/each}
</svg>

<style>
  .icon { flex: none; display: block; }
</style>
