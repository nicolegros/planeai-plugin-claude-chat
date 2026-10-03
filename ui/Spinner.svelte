<script lang="ts">
  let { size = 12 }: { size?: number } = $props();
</script>

<span class="spinner" style:width="calc({size} * var(--chat-unit, 1px))" style:height="calc({size} * var(--chat-unit, 1px))" aria-hidden="true"></span>

<style>
  .spinner { flex: none; display: inline-block; border: 1.5px solid var(--planeai-border-strong); border-top-color: var(--planeai-text); border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
