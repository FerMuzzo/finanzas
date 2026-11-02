<script lang="ts">
  import { app, persist, showOperations, toast } from '../app.svelte';
  import { formatDay, formatMonth } from '../../core/dates';
  import { formatCents } from '../../core/money';
  import { OP_LABELS } from '../../core/model';
  import { commitImport, previewImport, type CommitResult, type ImportPreview } from '../../core/importService';
  import { suggestions } from '../../core/recurring';
  import Icon from '../Icon.svelte';
  import AccountColor from '../AccountColor.svelte';
  import { nextAccountColor } from '../../core/model';

  let preview = $state<ImportPreview | null>(null);
  let accountName = $state('');
  let color = $state(1);
  let includePossible = $state(false);
  let error = $state('');
  let result = $state<CommitResult | null>(null);
  let input: HTMLInputElement | undefined = $state();

  async function onFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    error = '';
    result = null;
    preview = null;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('This file is larger than 10 MB, which is unusual for a bank export.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      preview = previewImport(bytes, file.name, $state.snapshot(app.data!) as never);
      accountName = preview.proposedAccountName;
      color = preview.account?.color ?? nextAccountColor(app.data!.accounts);
      includePossible = false;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      if (input) input.value = '';
    }
  }

  function doImport() {
    if (!preview || !app.data) return;
    result = commitImport(preview, app.data, accountName, { color, includePossible });
    persist();
    toast(`${result.added} operations imported`);
    preview = null;
  }

  const newSuggestions = $derived(app.data ? suggestions(app.data).length : 0);
  const sample = $derived(preview ? preview.rows.filter((r) => r.status === 'new').slice(0, 6) : []);
  const possibles = $derived(preview ? preview.rows.filter((r) => r.status === 'possible') : []);
  const manuals = $derived(preview ? preview.rows.filter((r) => r.status === 'manual') : []);
  const toImport = $derived(preview ? preview.newCount + preview.manualCount + (includePossible ? preview.possibleCount : 0) : 0);
</script>

<div class="page">
  <div class="topbar"><h1>Import</h1></div>

  {#if !preview}
    <label class="dropzone" data-testid="dropzone">
      <input bind:this={input} type="file" accept=".csv,.txt,text/csv,text/plain,application/vnd.ms-excel" onchange={onFile} />
      <Icon name="upload" size={32} />
      <strong>Choose a bank CSV file</strong>
      <small>Société Générale and Hello bank exports</small>
    </label>
    <p class="hint" style="margin-top: 10px">The file is read on this phone only. Its content is not kept after import, only the operations.</p>
  {/if}

  {#if error}<div class="notice bad" style="margin-top: 12px">{error}</div>{/if}

  {#if result}
    <div class="card" style="margin-top: 12px">
      <h2><span class="in"><Icon name="check" size={20} /></span> Import done</h2>
      <p>{result.added} new operations, {result.duplicates} already in the app{result.merged ? `, ${result.merged} merged with operations you added by hand` : ''}{result.possibleSkipped ? `, ${result.possibleSkipped} possible duplicate${result.possibleSkipped > 1 ? "s" : ""} skipped` : ''}.{result.transfersLinked ? ` ${result.transfersLinked} transfers between your accounts recognized.` : ''}</p>
      {#if newSuggestions > 0}<p>{newSuggestions} possible regular payment{newSuggestions > 1 ? 's' : ''} to confirm.</p>{/if}
      <div class="row" style="gap: 8px">
        <button class="block secondary" onclick={() => (app.tab = 'home')}>Overview</button>
        <button class="block" onclick={() => showOperations({ accountId: result!.accountId })}>Operations</button>
      </div>
    </div>
  {/if}

  {#if preview}
    <div class="card">
      <div class="row"><h2 style="margin: 0">{preview.parsed.bankName}</h2><span class="badge">{preview.fileName}</span></div>
      <dl class="kv" style="margin-top: 10px">
        <dt>Period</dt><dd>{preview.parsed.periodStart ? formatDay(preview.parsed.periodStart) + ' to ' + formatDay(preview.parsed.periodEnd!) : 'not stated'}</dd>
        <dt>Operations read</dt><dd>{preview.rows.length}{preview.parsed.announcedCount !== undefined ? ' of ' + preview.parsed.announcedCount + ' announced' : ''}</dd>
        {#if preview.parsed.balance}<dt>Balance</dt><dd class="num">{formatCents(preview.parsed.balance.amount)} on {formatDay(preview.parsed.balance.date)}</dd>{/if}
        <dt>New</dt><dd><strong>{preview.newCount}</strong></dd>
        <dt>Already in the app</dt><dd>{preview.duplicateCount}</dd>
        {#if preview.manualCount}<dt>Match your manual entries</dt><dd>{preview.manualCount}</dd>{/if}
        {#if preview.possibleCount}<dt>Possible duplicates</dt><dd>{preview.possibleCount}</dd>{/if}
      </dl>
    </div>

    {#if preview.integrityOk === true}
      <div class="notice ok">All {preview.rows.length} operations announced by the bank were read.</div>
    {:else if preview.integrityOk === false}
      <div class="notice bad">{preview.parsed.warnings[0]}</div>
    {/if}
    {#if preview.alreadyImportedAt}
      <div class="notice warn">This exact file was already imported on {formatDay(preview.alreadyImportedAt.slice(0, 10))}.</div>
    {/if}
    {#each preview.parsed.errors as e}<div class="notice bad">{e}</div>{/each}

    {#if manuals.length}
      <div class="notice ok">
        <strong>{manuals.length} operation{manuals.length > 1 ? 's' : ''} you added by hand {manuals.length > 1 ? 'are' : 'is'} in this file.</strong> They will be merged with the bank lines, keeping your category and note, so nothing is counted twice.
        <ul style="margin: 6px 0 0; padding-left: 18px">
          {#each manuals as r}<li>{r.match?.counterparty} ({formatCents(r.row.amount)}) is {r.info.counterparty}, {formatDay(r.info.opDate ?? r.row.date)}</li>{/each}
        </ul>
      </div>
    {/if}
    {#if possibles.length}
      <div class="notice warn">
        <strong>{possibles.length} possible duplicate{possibles.length > 1 ? 's' : ''}:</strong> same day, same amount and a similar name as an operation already in the app, but not exactly the same bank line. They are skipped unless you include them.
        <ul style="margin: 6px 0 8px; padding-left: 18px">
          {#each possibles as r}<li>{r.info.counterparty}, {formatDay(r.row.date)}, {formatCents(r.row.amount)}</li>{/each}
        </ul>
        <label style="display: flex; gap: 10px; align-items: center; font-weight: 500; margin: 0">
          <input type="checkbox" bind:checked={includePossible} style="width: 22px; min-height: 22px" /> Import them anyway
        </label>
      </div>
    {/if}

    <div class="card">
      <div class="field" style="margin-bottom: 0">
        <label for="acc">{preview.account ? 'Account (recognized)' : 'New account name'}</label>
        <input id="acc" bind:value={accountName} />
        {#if !preview.account}
          <div class="hint">Only the last 4 digits of the account number are kept.</div>
          <div style="margin-top: 12px"><p style="font-weight: 600; font-size: 0.9rem; margin-bottom: 6px">Color in the operations list</p><AccountColor bind:value={color} label="Account color" /></div>
        {/if}
      </div>
    </div>

    {#if preview.months.length}
      <div class="card">
        <h2>Months in this file</h2>
        <ul class="list">
          {#each preview.months as m}
            <li class="row" style="padding: 8px 0">
              <span>{formatMonth(m.month)} <small>· {m.count}</small></span>
              <span class="num"><span class="in">+{formatCents(m.income)}</span> · {formatCents(-m.spending)}</span>
            </li>
          {/each}
        </ul>
      </div>

      <div class="card" style="padding: 4px 14px">
        <ul class="list">
          {#each sample as r}
            <li class="tx" style="padding: 10px 0">
              <div class="main">
                <div class="name">{r.info.counterparty}</div>
                <div class="sub">{formatDay(r.row.date)} · {OP_LABELS[r.info.opType]}</div>
              </div>
              <div class="amt num" class:in={r.row.amount > 0}>{formatCents(r.row.amount, r.row.currency, { sign: true })}</div>
            </li>
          {/each}
        </ul>
        {#if preview.newCount > sample.length}<p class="hint">and {preview.newCount - sample.length} more</p>{/if}
      </div>
    {/if}

    <div class="row" style="gap: 8px">
      <button class="block secondary" onclick={() => (preview = null)}>Cancel</button>
      <button class="block" disabled={toImport === 0 || !accountName.trim()} onclick={doImport}>
        {toImport === 0 ? 'Nothing new' : `Import ${toImport}`}
      </button>
    </div>
  {/if}
</div>
