<script lang="ts">
  import { app, restoreFromBackup } from '../app.svelte';

  let { inline = false }: { inline?: boolean } = $props();
  let fileText = $state('');
  let fileName = $state('');
  let secret = $state('');
  let error = $state('');
  let confirming = $state(false);

  async function onFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    fileName = f.name;
    fileText = await f.text();
    error = '';
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    if (inline && !confirming) {
      confirming = true;
      return;
    }
    try {
      await restoreFromBackup(fileText, secret);
    } catch (err) {
      error = /Wrong/.test((err as Error).message) ? 'Wrong passphrase or recovery key for this backup.' : (err as Error).message;
    }
  }
</script>

<div class={inline ? '' : 'page center'}>
  {#if !inline}
    <h1>Restore a backup</h1>
    <p class="muted">Choose a backup file exported from this app, then enter the passphrase that was in use when it was made, or your recovery key.</p>
  {/if}
  <form onsubmit={submit}>
    <label class="dropzone" style="margin-bottom: 14px">
      <input type="file" accept=".json,application/json" onchange={onFile} />
      <strong>{fileName || 'Choose the backup file'}</strong>
      <small>{fileName ? 'Tap to choose another file' : 'finanzas-backup-....json'}</small>
    </label>
    <div class="field">
      <label for="secret">Passphrase or recovery key</label>
      <input id="secret" type="password" autocomplete="off" bind:value={secret} />
    </div>
    {#if error}<div class="notice bad">{error}</div>{/if}
    {#if confirming}<div class="notice warn">This replaces all data currently on this phone with the backup. Tap again to confirm.</div>{/if}
    <button class="block" type="submit" disabled={!fileText || !secret || app.busy}>
      {#if app.busy}<span class="spinner"></span> Restoring{:else}{confirming ? 'Yes, replace with the backup' : 'Restore'}{/if}
    </button>
    {#if !inline}
      <button class="block ghost" type="button" onclick={() => (app.phase = 'welcome')}>Back</button>
    {/if}
  </form>
</div>
