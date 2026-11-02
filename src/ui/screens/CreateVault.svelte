<script lang="ts">
  import { app, createNewVault } from '../app.svelte';
  import { passphraseStrength } from '../passphrase';

  let pass = $state('');
  let confirm = $state('');
  let error = $state('');
  const strength = $derived(passphraseStrength(pass));
  const canSubmit = $derived(strength.ok && pass === confirm && !app.busy);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    if (!canSubmit) return;
    try {
      await createNewVault(pass);
    } catch (err) {
      error = (err as Error).message;
    }
  }
</script>

<div class="page center">
  <h1>Choose a passphrase</h1>
  <p class="muted">It encrypts everything on this phone. A few random words work well, for example four words you will remember. It cannot be recovered by anyone, so you will also get a recovery key to print.</p>

  <form onsubmit={submit} style="margin-top: 10px">
    <div class="field">
      <label for="p1">Passphrase</label>
      <input id="p1" type="password" autocomplete="new-password" bind:value={pass} />
      {#if pass}
        <div class="hint" class:bad={!strength.ok}>{strength.label}</div>
      {/if}
    </div>
    <div class="field">
      <label for="p2">Repeat it</label>
      <input id="p2" type="password" autocomplete="new-password" bind:value={confirm} />
      {#if confirm && confirm !== pass}<div class="hint bad">The two entries differ.</div>{/if}
    </div>
    {#if error}<div class="notice bad">{error}</div>{/if}
    <button class="block" type="submit" disabled={!canSubmit}>
      {#if app.busy}<span class="spinner"></span> Creating the vault{:else}Create the vault{/if}
    </button>
    <button class="block ghost" type="button" onclick={() => (app.phase = 'welcome')}>Back</button>
  </form>
</div>
