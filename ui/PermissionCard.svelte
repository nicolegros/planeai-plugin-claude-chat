<script lang="ts">
  import ToolInputView from "./ToolInputView.svelte";
  import type { PermissionEntry } from "./transcript.svelte";

  type Decision = "allow" | "allow_session" | "deny";
  let { permission, onRespond }: { permission: PermissionEntry; onRespond: (decision: Decision, reason?: string) => void } = $props();
  let denying = $state(false);
  let reason = $state("");
</script>

<section class="permission" class:resolved={permission.resolved !== null} aria-label="Permission request">
  <p class="title">{permission.title}</p>
  <ToolInputView input={permission.input} summary={permission.summary} />
  {#if permission.resolved === null}
    {#if denying}
      <form class="deny" onsubmit={(event) => { event.preventDefault(); onRespond("deny", reason); }}>
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={reason} placeholder="Tell Claude what to do instead (optional)" aria-label="Reason for denying" autofocus />
        <button type="submit">Deny</button>
        <button type="button" class="quiet" onclick={() => (denying = false)}>Back</button>
      </form>
    {:else}
      <div class="actions">
        <button type="button" class="primary" onclick={() => onRespond("allow")}>Allow</button>
        {#if permission.can_remember}
          <button type="button" onclick={() => onRespond("allow_session")}>Allow for this session</button>
        {/if}
        <button type="button" onclick={() => (denying = true)}>Deny…</button>
      </div>
    {/if}
  {:else}
    <p class="resolution">
      {permission.resolved ? (permission.remembered ? "Allowed for this session" : "Allowed") : permission.reason ? `Denied: ${permission.reason}` : "Denied"}
    </p>
  {/if}
</section>

<style>
  .permission { display: grid; gap: var(--planeai-space-2); padding: var(--planeai-space-3); border: 1px solid var(--planeai-warning); border-radius: var(--planeai-radius); background: color-mix(in srgb, var(--planeai-warning) 6%, var(--planeai-surface)); }
  .permission.resolved { border-color: var(--planeai-border); background: var(--planeai-surface); }
  .title { font-weight: 600; }
  .actions, .deny { display: flex; flex-wrap: wrap; gap: var(--planeai-space-2); }
  .deny input { flex: 1; min-width: 200px; }
  .resolution { color: var(--planeai-text-subtle); font-size: 12px; }
  button.primary { background: var(--planeai-accent); color: var(--planeai-on-accent); border-color: var(--planeai-accent); }
  button.quiet { border-color: transparent; background: transparent; }
</style>
