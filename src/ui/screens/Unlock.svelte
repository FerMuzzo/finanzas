<script lang="ts">
  import { onMount } from 'svelte';
  import { app, unlock, unlockWithBio, unlockWithRecoveryKey } from '../app.svelte';
  import { passphraseStrength } from '../passphrase';

  let mode = $state<'pass' | 'recovery'>('pass');
  let pass = $state('');
  let recovery = $state('');
  let newPass = $state('');
  let error = $state('');
  const strength = $derived(passphraseStrength(newPass));

  async function bio() {
    error = '';
    try {
      await unlockWithBio();
    } catch (err) {
      const name = (err as Error).name;
      if (name === 'NotAllowedError' || name === 'AbortError' || (err as Error).message === 'Cancelled') error = 'Fingerprint cancelled. Try again or use your passphrase.';
      else error = (err as Error).message;
    }
  }

  onMount(() => {
    // Offer the fingerprint prompt right away when the app opens
    if (app.autoBio && app.bioOn) {
      app.autoBio = false;
      void bio();
    }
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    try {
      if (mode === 'pass') await unlock(pass);
      else await unlockWithRecoveryKey(recovery, newPass);
      pass = '';
      recovery = '';
      newPass = '';
    } catch (err) {
      error = mode === 'pass' ? 'Wrong passphrase.' : 'Wrong recovery key.';
      if (!(err instanceof Error) || !/Wrong/.test(err.message)) error = (err as Error).message;
    }
  }
</script>

<div class="page center">
  <img class="logo" src="./icon-192.png" alt="" />
  <h1>Unlock</h1>
  {#if app.bioOn && mode === 'pass'}
    <button class="block" style="margin-bottom: 18px" onclick={bio} disabled={app.busy}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 11v3m-4-3a4 4 0 0 1 8 0v2a8 8 0 0 1-1 4M5 9a7 7 0 0 1 14 0v3M9 21a12 12 0 0 1-1-7m11 3a14 14 0 0 0 0-3"/></svg>
      Unlock with fingerprint
    </button>
    <p class="hint" style="text-align: center; margin-bottom: 10px">or use your passphrase</p>
  {/if}
  <form onsubmit={submit}>
    {#if mode === 'pass'}
      <div class="field">
        <label for="pass">Passphrase</label>
        <!-- svelte-ignore a11y_autofocus -->
        <input id="pass" type="password" autocomplete="current-password" bind:value={pass} autofocus={!app.bioOn} />
      </div>
    {:else}
      <div class="field">
        <label for="rk">Recovery key</label>
        <input id="rk" autocomplete="off" autocapitalize="characters" spellcheck="false" bind:value={recovery} placeholder="XXXX XXXX XXXX ..." />
      </div>
      <div class="field">
        <label for="np">New passphrase</label>
        <input id="np" type="password" autocomplete="new-password" bind:value={newPass} />
        {#if newPass}<div class="hint" class:bad={!strength.ok}>{strength.label}</div>{/if}
      </div>
    {/if}
    {#if error}<div class="notice bad">{error}</div>{/if}
    <button class="block" class:secondary={app.bioOn && mode === 'pass'} type="submit" disabled={app.busy || (mode === 'pass' ? !pass : !recovery || !strength.ok)}>
      {#if app.busy}<span class="spinner"></span> Unlocking{:else}Unlock{/if}
    </button>
    <button class="block ghost" type="button" onclick={() => { mode = mode === 'pass' ? 'recovery' : 'pass'; error = ''; }}>
      {mode === 'pass' ? 'Forgot it? Use the recovery key' : 'Use the passphrase instead'}
    </button>
  </form>
</div>
