<script lang="ts">
  import { onMount } from 'svelte';
  import { app, backupFile, changePassphrase, eraseEverything, isPersisted, lock, persist, requestPersistence, toast } from '../app.svelte';
  import { formatDay } from '../../core/dates';
  import { applyOwnNameHints } from '../../core/ownNames';
  import { categorizeAll } from '../../core/categorize';
  import { linkSeries } from '../../core/recurring';
  import { uid } from '../../core/text';
  import { BANK_NAMES } from '../../core/model';
  import { passphraseStrength } from '../passphrase';
  import Restore from './Restore.svelte';
  import AccountColor from '../AccountColor.svelte';

  const data = $derived(app.data!);
  let names = $state(app.data!.settings.holderNames.join(', '));
  let persisted = $state<boolean | null>(null);
  let showRestore = $state(false);
  let showPass = $state(false);
  let cur = $state('');
  let next = $state('');
  let passMsg = $state('');
  let eraseText = $state('');
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
      const { name, blob } = await backupFile();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('Backup saved to Downloads');
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
    <h2>Backups</h2>
    <p class="muted">Your data only lives on this phone. A backup file is encrypted with your passphrase; keep a copy in your cloud drive or on your computer.</p>
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
    <p class="muted">Used to recognize transfers to yourself, for example between your Société Générale and Hello bank accounts. Separate names with commas.</p>
    <div class="field"><input bind:value={names} placeholder="First name Last name" /></div>
    <button class="secondary" onclick={saveNames}>Save names</button>
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
    <ul class="list">
      {#each data.accounts as a (a.id)}
        <li style="padding: 12px 0">
          <input value={a.name} aria-label="Account name" onchange={(e) => { a.name = (e.target as HTMLInputElement).value.trim() || a.name; persist(); }} />
          <small style="display: block; margin: 6px 0 8px">{BANK_NAMES[a.bank]}{a.last4 ? ' · ending ' + a.last4 : ''} · {data.transactions.filter((t) => t.accountId === a.id).length} operations</small>
          <AccountColor bind:value={() => a.color ?? 1, (v) => { a.color = v; persist(); }} label="Color of {a.name}" />
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
      <p class="muted">Deletes the vault from this phone. Only a backup file can bring it back. Type ERASE to confirm.</p>
      <div class="row" style="gap: 8px">
        <input bind:value={eraseText} placeholder="ERASE" autocapitalize="characters" />
        <button class="danger" disabled={eraseText !== 'ERASE'} onclick={erase}>Erase</button>
      </div>
    </div>
  {/if}

  <p class="hint" style="text-align: center">Finanzas {__APP_VERSION__} · data stays on this phone</p>
</div>
