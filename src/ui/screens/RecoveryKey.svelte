<script lang="ts">
  import { app, finishRecoveryStep } from '../app.svelte';

  let saved = $state(false);
  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(app.recoveryKey);
      copied = true;
    } catch {
      copied = false;
    }
  }
</script>

<div class="page center">
  <h1>Your recovery key</h1>
  <p class="muted">If you forget your passphrase, this key is the only way back into your data. Write it on paper and keep it at home. Do not store it in this phone.</p>

  <div class="recovery" data-testid="recovery-key">{app.recoveryKey}</div>
  <button class="ghost" onclick={copy} style="margin: 6px auto 12px; display: flex">{copied ? 'Copied, paste it somewhere safe' : 'Copy'}</button>

  <label style="display: flex; gap: 10px; align-items: center; font-weight: 500">
    <input type="checkbox" bind:checked={saved} style="width: 22px; min-height: 22px" />
    I have written down my recovery key
  </label>
  <button class="block" style="margin-top: 16px" disabled={!saved} onclick={finishRecoveryStep}>Continue</button>
</div>
