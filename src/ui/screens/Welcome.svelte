<script lang="ts">
  import { app, startDemo } from '../app.svelte';
  const preview = import.meta.env.VITE_PREVIEW === '1';
  const e2e = import.meta.env.VITE_E2E === '1'; // test build only
</script>

<div class="page center">
  <img class="logo" src="./icon-192.png" alt="" />
  <h1>Finanzas</h1>
  <p class="muted">Track every account, see where your money goes, and build a savings plan. Your data stays on this phone, encrypted with your passphrase.</p>

  {#if preview}
    <div class="notice warn" style="margin-top: 12px">Preview: this copy only runs the demo with invented data. Your real app will live at your own address, installed on your phone.</div>
    <button class="block" onclick={startDemo}>Open the demo</button>
  {:else}
    <div class="stack" style="margin-top: 18px">
      <button class="block" onclick={() => (app.phase = 'create')}>Create my vault</button>
      <button class="block secondary" onclick={() => (app.phase = 'restore')}>Restore from a backup file</button>
      {#if e2e}<button class="block ghost" onclick={startDemo}>Try it with invented demo data</button>{/if}
    </div>
  {/if}

  <p class="hint" style="margin-top: 22px">Nothing you enter is sent anywhere. There is no account and no server.</p>
</div>
