<script lang="ts">
  import { onMount } from 'svelte';
  import { app, backupFile, backupName, changePassphrase, chooseMirror, disableBio, enableBio, eraseEverything, isPersisted, lock, mirror, persist, requestPersistence, resumeMirror, saveFileWithPicker, stopMirror, toast } from '../app.svelte';
  import { formatDay } from '../../core/dates';
  import { applyOwnNameHints } from '../../core/ownNames';
  import { categorizeAll } from '../../core/categorize';
  import { linkSeries } from '../../core/recurring';
  import { uid } from '../../core/text';
  import { BANK_NAMES } from '../../core/model';
  import { passphraseStrength } from '../passphrase';
  import Restore from './Restore.svelte';
  import AccountColor from '../AccountColor.svelte';
  import NewAccountForm from '../NewAccountForm.svelte';
  import AccountSheet from '../AccountSheet.svelte';
  import CategoriesManager from '../CategoriesManager.svelte';
  import type { Account } from '../../core/model';

  const data = $derived(app.data!);
  let names = $state(app.data!.settings.holderNames.join(', '));
  let persisted = $state<boolean | null>(null);
  let showRestore = $state(false);
  let showPass = $state(false);
  let cur = $state('');
  let next = $state('');
  let passMsg = $state('');
  let eraseText = $state('');
  let bioPass = $state('');
  let bioForm = $state(false);
  let bioMsg = $state('');
  let addingAccount = $state(false);
  let sheetAccount = $state<Account | null>(null);
  let rulePattern = $state('');
  let ruleCat = $state('');
  const learned = $derived(Object.keys(data.merchantMemory).length);
  const strength = $derived(passphraseStrength(next));

  onMount(async () => {
    persisted = await isPersisted();
  });

  function saveNames() {
    data.settings.holderNames = names.split(',').map((s) => s.trim()).filter(Boolean);
    applyOwnNameHints(data);
    refresh();
    toast('Saved');
  }

  function refresh() {
    const n = categorizeAll(data);
    linkSeries(data);
    persist();
    return n;
  }

  function addRule(e: SubmitEvent) {
    e.preventDefault();
    if (!rulePattern.trim() || !ruleCat) return;
    data.rules.push({ id: uid(), pattern: rulePattern.trim(), categoryId: ruleCat, createdAt: new Date().toISOString() });
    rulePattern = '';
    const n = refresh();
    toast(`Rule saved, ${n} operation${n === 1 ? '' : 's'} updated`);
  }

  function removeRule(id: string) {
    data.rules = data.rules.filter((r) => r.id !== id);
    refresh();
  }

  function forgetLearned() {
    data.merchantMemory = {};
    const n = refresh();
    toast(`Learned merchants cleared, ${n} operations updated`);
  }

  function setLock(e: Event) {
    data.settings.autoLockMinutes = Number((e.target as HTMLSelectElement).value);
    persist();
  }

  async function download() {
    try {
      const where = await saveFileWithPicker(backupName(), async () => (await backupFile()).blob);
      if (where) toast(where === 'Downloads' ? 'Backup saved to Downloads' : `Backup saved as ${where}`);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function pickMirror() {
    try {
      if (await chooseMirror()) toast(`Encrypted copy saved in ${mirror.name}`);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function share() {
    try {
      const { name, blob } = await backupFile();
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Finanzas backup' });
      } else {
        toast('Sharing files is not available here, use Save instead.');
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast((e as Error).message);
    }
  }

  async function askPersist() {
    persisted = await requestPersistence();
    toast(persisted ? 'Storage is now protected' : 'Chrome declined for now. Installing the app on the home screen usually helps.');
  }

  async function doChangePass(e: SubmitEvent) {
    e.preventDefault();
    passMsg = '';
    try {
      await changePassphrase(cur, next);
      cur = '';
      next = '';
      showPass = false;
      toast('Passphrase changed');
    } catch {
      passMsg = 'The current passphrase is wrong.';
    }
  }

  async function turnOnBio(e: SubmitEvent) {
    e.preventDefault();
    bioMsg = '';
    try {
      await enableBio(bioPass);
      bioPass = '';
      bioForm = false;
      toast('Fingerprint unlock is on');
    } catch (err) {
      const er = err as Error;
      if (/Wrong/.test(er.message)) bioMsg = 'The passphrase is wrong.';
      else if (er.name === 'NotAllowedError' || er.name === 'AbortError') bioMsg = 'Cancelled. Try again when ready.';
      else bioMsg = er.message;
    }
  }

  async function turnOffBio() {
    await disableBio();
    toast('Fingerprint unlock is off');
  }

  async function erase() {
    if (eraseText !== 'ERASE') return;
    await eraseEverything();
  }
</script>

<div class="page">
  <div class="topbar"><h1>Settings</h1></div>

  {#if app.demo}
    <div class="notice warn">Demo mode: nothing is saved. Lock to leave the demo.</div>
  {/if}

  <div class="card">
    <h2>Where your data is saved</h2>
    <p class="muted">The working copy is always on this phone, in Chrome's private storage for this app, encrypted with your passphrase. Android decides where that storage is, and no other app can read it.</p>
    <h3 style="margin-top: 12px">Encrypted copy in a file you choose</h3>
    {#if !mirror.supported}
      <p class="muted">This browser cannot write to a file you choose. Use Save backup or Share backup below and pick the destination each time.</p>
    {:else if mirror.status === 'off'}
      <p class="muted">Choose a folder and a file name, for example in Documents, on an SD card, or in a cloud drive offered by the file picker. The app then rewrites that file after every change. It is encrypted like a backup and can be opened with Restore.</p>
      <button class="secondary" onclick={pickMirror} disabled={app.demo}>Choose a location</button>
    {:else}
      <div class="row" style="margin-bottom: 8px">
        <span><strong>{mirror.name}</strong></span>
        {#if mirror.status === 'ok'}<span class="badge accent">Updated after every change</span>{:else if mirror.status === 'needs-permission'}<span class="badge warn">Paused</span>{:else}<span class="badge warn">Error</span>{/if}
      </div>
      {#if mirror.lastWrite}<p class="hint">Last written {new Date(mirror.lastWrite).toLocaleString('en-GB')}</p>{/if}
      {#if mirror.status === 'needs-permission'}<p class="muted">Chrome asks again for permission after the app restarts.</p>{/if}
      {#if mirror.status === 'error'}<p class="notice bad">{mirror.error || 'The file could not be written.'}</p>{/if}
      <div class="row" style="gap: 8px">
        {#if mirror.status !== 'ok'}<button class="block" onclick={resumeMirror}>Allow writing again</button>{/if}
        <button class="block secondary" onclick={pickMirror}>Change location</button>
        <button class="block secondary" onclick={stopMirror}>Stop</button>
      </div>
    {/if}
  </div>

  <div class="card">
    <h2>Backups</h2>
    <p class="muted">A backup file is encrypted with your passphrase. Save it where you choose, or share it to your cloud drive or computer.</p>
    {#if data.settings.lastBackupAt}<p class="hint">Last backup: {formatDay(data.settings.lastBackupAt.slice(0, 10))}</p>{/if}
    <div class="row" style="gap: 8px">
      <button class="block" onclick={download} disabled={app.demo}>Save backup</button>
      <button class="block secondary" onclick={share} disabled={app.demo}>Share backup</button>
    </div>
    {#if !app.demo}
      <button class="block ghost" onclick={() => (showRestore = !showRestore)}>{showRestore ? 'Hide restore' : 'Restore a backup on this phone'}</button>
      {#if showRestore}<Restore inline />{/if}
    {/if}
  </div>

  <div class="card">
    <h2>Your names</h2>
    <p class="muted">Used to flag transfers to yourself, for example between your Société Générale and Hello bank accounts. Separate names with commas. To have transfers recorded in a given account automatically, set its own transfer names under Accounts below.</p>
    <div class="field"><input bind:value={names} placeholder="First name Last name" /></div>
    <button class="secondary" onclick={saveNames}>Save names</button>
  </div>

  <div class="card" data-testid="categories-card">
    <h2>Categories</h2>
    <p class="muted">Add your own, rename them, or delete one and move its operations to another. Tap a category to change it; the number is how many operations it has.</p>
    <CategoriesManager />
  </div>

  <div class="card">
    <h2>Category rules</h2>
    <p class="muted">A rule puts every operation whose name or bank text contains some words in a category, for example a client's name in Freelance income. Rules come before everything else, except choices you make by hand.</p>
    {#if data.rules.length}
      <ul class="list" style="margin-bottom: 10px">
        {#each data.rules as r (r.id)}
          <li class="row" style="padding: 8px 0">
            <span>"{r.pattern}" → {data.categories.find((c) => c.id === r.categoryId)?.name}</span>
            <button class="small ghost" onclick={() => removeRule(r.id)}>Remove</button>
          </li>
        {/each}
      </ul>
    {/if}
    <form onsubmit={addRule}>
      <div class="field"><input bind:value={rulePattern} placeholder="Words to find, for example URSSAF" /></div>
      <div class="field">
        <select bind:value={ruleCat} aria-label="Category for the rule">
          <option value="">Choose a category</option>
          {#each data.categories as c}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </div>
      <button class="secondary" type="submit" disabled={!rulePattern.trim() || !ruleCat}>Add rule</button>
    </form>
    {#if learned > 0}
      <p class="hint" style="margin-top: 12px">The app has learned the category of {learned} merchant{learned > 1 ? 's' : ''} from your choices.
        <button class="small ghost" onclick={forgetLearned}>Forget them</button></p>
    {/if}
  </div>

  <div class="card">
    <h2>Security</h2>
    <div class="field">
      <label for="al">Lock automatically after</label>
      <select id="al" value={String(data.settings.autoLockMinutes)} onchange={setLock}>
        <option value="1">1 minute</option>
        <option value="2">2 minutes</option>
        <option value="5">5 minutes</option>
        <option value="10">10 minutes</option>
      </select>
      <div class="hint">The app also locks when it stays in the background for more than a minute.</div>
    </div>
    <div style="margin-bottom: 14px">
      <div class="row">
        <strong>Unlock with fingerprint</strong>
        {#if app.bioOn}<span class="badge accent">On</span>{/if}
      </div>
      {#if app.demo}
        <p class="hint">Not available in the demo.</p>
      {:else if !app.bioAvailable && !app.bioOn}
        <p class="hint">This phone or browser does not offer fingerprint unlock for web apps. Check that a screen lock and a fingerprint are set up in Android settings.</p>
      {:else if app.bioOn}
        <p class="hint">Your fingerprint (or screen lock) unlocks the app. The passphrase and the recovery key still work too.</p>
        <button class="secondary small" onclick={turnOffBio}>Turn off</button>
      {:else if !bioForm}
        <p class="hint">Uses a passkey stored by Android and protected by your fingerprint. It gives the app the secret that opens your encrypted data, so nothing usable is left on the phone without it.</p>
        <button class="secondary small" onclick={() => (bioForm = true)}>Turn on</button>
      {:else}
        <form onsubmit={turnOnBio} style="margin-top: 8px">
          <div class="field">
            <label for="bp">Confirm with your passphrase</label>
            <input id="bp" type="password" autocomplete="current-password" bind:value={bioPass} />
          </div>
          {#if bioMsg}<div class="notice bad">{bioMsg}</div>{/if}
          <div class="row" style="gap: 8px">
            <button class="block secondary" type="button" onclick={() => { bioForm = false; bioMsg = ''; }}>Cancel</button>
            <button class="block" type="submit" disabled={!bioPass || app.busy}>Continue</button>
          </div>
          <p class="hint">Android then asks for your fingerprint, once or twice.</p>
        </form>
      {/if}
    </div>
    <div class="row" style="gap: 8px">
      <button class="block secondary" onclick={lock}>Lock now</button>
      <button class="block secondary" onclick={() => (showPass = !showPass)} disabled={app.demo}>Change passphrase</button>
    </div>
    {#if showPass}
      <form onsubmit={doChangePass} style="margin-top: 12px">
        <div class="field"><label for="cp">Current passphrase</label><input id="cp" type="password" autocomplete="current-password" bind:value={cur} /></div>
        <div class="field">
          <label for="np2">New passphrase</label><input id="np2" type="password" autocomplete="new-password" bind:value={next} />
          {#if next}<div class="hint" class:bad={!strength.ok}>{strength.label}</div>{/if}
        </div>
        {#if passMsg}<div class="notice bad">{passMsg}</div>{/if}
        <button class="block" type="submit" disabled={!cur || !strength.ok || app.busy}>Change</button>
        <p class="hint">Your recovery key stays the same.</p>
      </form>
    {/if}
    <div class="row" style="margin-top: 14px">
      <span>Storage protected from cleanup</span>
      {#if persisted}<span class="badge accent">Yes</span>{:else}<button class="small secondary" onclick={askPersist}>Request</button>{/if}
    </div>
  </div>

  <div class="card">
    <h2>Accounts and imports</h2>
    {#if addingAccount}
      <div class="card flat" style="margin: 4px 0 12px">
        <h3 style="margin-top: 0">New account</h3>
        <NewAccountForm onsave={() => (addingAccount = false)} oncancel={() => (addingAccount = false)} />
      </div>
    {:else}
      <p class="muted" style="margin-top: -4px">For an account whose bank gives no CSV export, add it here, then import its PDF statements or record in it the transfers you make from your other accounts.</p>
      <button class="block secondary" style="margin-bottom: 8px" onclick={() => (addingAccount = true)}>Add an account</button>
    {/if}
    <ul class="list">
      {#each data.accounts as a (a.id)}
        <li style="padding: 12px 0">
          <input value={a.name} aria-label="Account name" onchange={(e) => { a.name = (e.target as HTMLInputElement).value.trim() || a.name; persist(); }} />
          <small style="display: block; margin: 6px 0 8px">{BANK_NAMES[a.bank]}{a.last4 ? ' · ending ' + a.last4 : ''} · {data.transactions.filter((t) => t.accountId === a.id).length} operations</small>
          <AccountColor bind:value={() => a.color ?? 1, (v) => { a.color = v; persist(); }} label="Color of {a.name}" />
          <button class="small secondary" style="margin-top: 8px" onclick={() => (sheetAccount = a)}>
            Transfer names and balance{a.transferNames?.length ? ` (${a.transferNames.length} name${a.transferNames.length === 1 ? '' : 's'})` : ''}
          </button>
        </li>
      {/each}
    </ul>
    {#if data.imports.length}
      <p class="hint" style="margin-top: 8px">Last import: {formatDay(data.imports[data.imports.length - 1].importedAt.slice(0, 10))}, {data.imports.length} in total.</p>
    {/if}
  </div>

  {#if !app.demo}
    <div class="card">
      <h2>Erase everything</h2>
      <p class="muted">Deletes the vault from this phone. Only a backup file can bring it back. A copy file you chose yourself is not deleted. Type ERASE to confirm.</p>
      <div class="row" style="gap: 8px">
        <input bind:value={eraseText} placeholder="ERASE" autocapitalize="characters" />
        <button class="danger" disabled={eraseText !== 'ERASE'} onclick={erase}>Erase</button>
      </div>
    </div>
  {/if}

  <p class="hint" style="text-align: center">Finanzas {__APP_VERSION__} · data stays on this phone</p>
</div>

{#if sheetAccount}<AccountSheet account={sheetAccount} onclose={() => (sheetAccount = null)} />{/if}

