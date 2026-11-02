<script lang="ts">
  import { app, unlock, unlockWithRecoveryKey } from '../app.svelte';
  import { passphraseStrength } from '../passphrase';

  let mode = $state<'pass' | 'recovery'>('pass');
  let pass = $state('');
  let recovery = $state('');
  let newPass = $state('');
  let error = $state('');
  const strength = $derived(passphraseStrength(newPass));

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
  <form onsubmit={submit}>
    {#if mode === 'pass'}
      <div class="field">
        <label for="pass">Passphrase</label>
        <!-- svelte-ignore a11y_autofocus -->
        <input id="pass" type="password" autocomplete="current-password" bind:value={pass} autofocus />
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
    <button class="block" type="submit" disabled={app.busy || (mode === 'pass' ? !pass : !recovery || !strength.ok)}>
      {#if app.busy}<span class="spinner"></span> Unlocking{:else}Unlock{/if}
    </button>
    <button class="block ghost" type="button" onclick={() => { mode = mode === 'pass' ? 'recovery' : 'pass'; error = ''; }}>
      {mode === 'pass' ? 'Forgot it? Use the recovery key' : 'Use the passphrase instead'}
    </button>
  </form>
</div>
