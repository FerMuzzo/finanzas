<script lang="ts">
  import { app, persist, showOperations, toast } from '../app.svelte';
  import { formatDay, formatMonth } from '../../core/dates';
  import { formatCents } from '../../core/money';
  import { OP_LABELS, nextAccountColor } from '../../core/model';
  import { commitImport, previewImport, previewPdf, type CommitResult, type ImportPreview, type PdfInput, type PreviewRow } from '../../core/importService';
  import { checkStatement } from '../../core/pdfStatement';
  import { suggestions } from '../../core/recurring';
  import Icon from '../Icon.svelte';
  import AccountColor from '../AccountColor.svelte';

  let preview = $state<ImportPreview | null>(null);
  let pdfInputs = $state<PdfInput[]>([]);
  let target = $state('new'); // account the PDF statements go to: an id, or "new"
  let accountName = $state('');
  let savingsType = $state(false);
  let color = $state(1);
  let includePossible = $state(false);
  let error = $state('');
  let failed = $state<string[]>([]);
  let reading = $state('');
  let result = $state<CommitResult | null>(null);
  let input: HTMLInputElement | undefined = $state();

  function snapshot() {
    return $state.snapshot(app.data!) as never;
  }

  async function onFiles(e: Event) {
    const files = [...((e.target as HTMLInputElement).files ?? [])];
    if (!files.length) return;
    error = '';
    failed = [];
    result = null;
    preview = null;
    try {
      const { isPdf, readStatementPdf } = await import('../pdfText');
      const pdfs = files.filter(isPdf);
      if (pdfs.length && pdfs.length !== files.length) throw new Error('Choose either CSV files or PDF statements, not both at once.');
      for (const f of files) if (f.size > 15 * 1024 * 1024) throw new Error(`${f.name} is larger than 15 MB, which is unusual for a bank file.`);
      if (pdfs.length) {
        const ok: PdfInput[] = [];
        for (const [i, f] of pdfs.entries()) {
          reading = pdfs.length > 1 ? `Reading statement ${i + 1} of ${pdfs.length}` : 'Reading the statement';
          try {
            const r = await readStatementPdf(f);
            if (r.parsed.rows.length) ok.push(r);
            else failed.push(`${f.name}: ${r.parsed.errors[0] ?? 'no operations found.'}`);
          } catch (err) {
            failed.push(`${f.name}: ${(err as Error).message}`);
          }
        }
        reading = '';
        if (!ok.length) throw new Error('No operations could be read from the chosen PDF files.');
        pdfInputs = ok;
        const p = previewPdf(ok, snapshot());
        preview = p;
        target = p.account?.id ?? 'new';
        accountName = p.proposedAccountName;
        savingsType = p.proposedType === 'savings';
        color = p.account?.color ?? nextAccountColor(app.data!.accounts);
      } else {
        if (files.length > 1) throw new Error('Choose one CSV file at a time.');
        const bytes = new Uint8Array(await files[0].arrayBuffer());
        pdfInputs = [];
        preview = previewImport(bytes, files[0].name, snapshot());
        accountName = preview.proposedAccountName;
        color = preview.account?.color ?? nextAccountColor(app.data!.accounts);
        includePossible = false;
      }
    } catch (err) {
      error = (err as Error).message;
    } finally {
      reading = '';
      if (input) input.value = '';
    }
  }

  /** Another target account changes what is already there: keep the directions and choices you made. */
  function retarget() {
    if (!preview || !pdfInputs.length) return;
    const kept = new Map(preview.rows.map((r) => [r.fp, { amount: r.amount, include: r.include, flipped: r.amount !== r.row.amount }]));
    const p = previewPdf($state.snapshot(pdfInputs) as PdfInput[], snapshot(), target === 'new' ? null : target);
    for (const r of p.rows) {
      const k = kept.get(r.fp);
      if (!k) continue;
      if (k.flipped) r.amount = k.amount;
      if (r.status === 'new' && !k.include) r.include = false;
    }
    preview = p;
    if (target === 'new') accountName = p.proposedAccountName;
  }

  function flip(r: PreviewRow) {
    r.amount = -r.amount;
  }

  function doImport() {
    if (!preview || !app.data) return;
    result = commitImport(preview, app.data, target === 'new' || preview.format === 'csv' ? accountName : undefined, {
      color,
      includePossible,
      type: savingsType ? 'savings' : 'checking',
    });
    persist();
    toast(`${result.added} operations imported`);
    preview = null;
    pdfInputs = [];
  }

  function cancel() {
    preview = null;
    pdfInputs = [];
  }

  const isPdfPreview = $derived(preview?.format === 'pdf');
  const newSuggestions = $derived(app.data ? suggestions(app.data).length : 0);
  const sample = $derived(preview ? preview.rows.filter((r) => r.status === 'new').slice(0, 6) : []);
  const possibles = $derived(preview ? preview.rows.filter((r) => r.status === 'possible') : []);
  const manuals = $derived(preview ? preview.rows.filter((r) => r.status === 'manual') : []);
  const toImport = $derived(
    !preview
      ? 0
      : isPdfPreview
        ? preview.rows.filter((r) => r.include && r.status !== 'duplicate').length
        : preview.newCount + preview.manualCount + (includePossible ? preview.possibleCount : 0),
  );
  const checks = $derived(
    preview && isPdfPreview
      ? preview.parts.map((part, i) => ({
          part,
          check: checkStatement(part.pdf!, preview!.rows.filter((r) => r.part === i).map((r) => r.amount)),
        }))
      : [],
  );
  const guessed = $derived(preview && isPdfPreview ? preview.parts.reduce((s, p) => s + (p.pdf?.guessedSigns ?? 0), 0) : 0);
  const otherAccounts = $derived(app.data?.accounts ?? []);
  const isNew = $derived(isPdfPreview ? target === 'new' : !preview?.account);

  const STATUS: Record<string, string> = { duplicate: 'already in the app', manual: 'matches an entry you added', possible: 'possible duplicate' };
</script>

<div class="page">
  <div class="topbar">
    <h1>Import</h1>
    <button class="small ghost" onclick={() => (app.tab = 'home')}>Close</button>
  </div>

  {#if !preview}
    <label class="dropzone" data-testid="dropzone">
      <input bind:this={input} type="file" multiple accept=".csv,.txt,.pdf,text/csv,text/plain,application/pdf,application/vnd.ms-excel" onchange={onFiles} disabled={!!reading} />
      <Icon name="upload" size={32} />
      <strong>{reading || 'Choose bank files'}</strong>
      <small>A CSV export of Société Générale or Hello bank, or monthly PDF statements (you can choose several)</small>
    </label>
    <p class="hint" style="margin-top: 10px">Files are read on this phone only. Their content is not kept after import, only the operations.</p>
  {/if}

  {#if error}<div class="notice bad" style="margin-top: 12px">{error}</div>{/if}
  {#if failed.length}
    <div class="notice warn" style="margin-top: 12px">
      <strong>Not read:</strong>
      <ul style="margin: 4px 0 0; padding-left: 18px">{#each failed as f}<li>{f}</li>{/each}</ul>
    </div>
  {/if}

  {#if result}
    <div class="card" style="margin-top: 12px">
      <h2><span class="in"><Icon name="check" size={20} /></span> Import done</h2>
      <p>{result.added} new operations, {result.duplicates} already in the app{result.merged ? `, ${result.merged} merged with operations you added by hand` : ''}{result.possibleSkipped ? `, ${result.possibleSkipped} possible duplicate${result.possibleSkipped > 1 ? 's' : ''} skipped` : ''}{result.excluded ? `, ${result.excluded} left out by you` : ''}.{result.transfersLinked ? ` ${result.transfersLinked} transfers between your accounts recognized.` : ''}</p>
      {#if newSuggestions > 0}<p>{newSuggestions} possible regular payment{newSuggestions > 1 ? 's' : ''} to confirm.</p>{/if}
      <div class="row" style="gap: 8px">
        <button class="block secondary" onclick={() => (app.tab = 'home')}>Overview</button>
        <button class="block" onclick={() => showOperations({ accountIds: [result!.accountId] })}>Operations</button>
      </div>
    </div>
  {/if}

  {#if preview}
    <div class="card">
      <div class="row"><h2 style="margin: 0">{isPdfPreview ? (preview.parts.length > 1 ? `${preview.parts.length} PDF statements` : 'PDF statement') : preview.parsed.bankName}</h2>{#if !isPdfPreview || preview.parts.length === 1}<span class="badge">{preview.fileName}</span>{/if}</div>
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

    {#each checks as c}
      <div class="notice {c.check.status === 'ok' ? 'ok' : c.check.status === 'mismatch' ? 'bad' : 'warn'}" data-testid="pdf-check">
        {#if preview.parts.length > 1}<strong>{c.part.fileName}</strong><br />{/if}
        {#if c.check.status === 'ok'}
          <Icon name="check" size={16} /> {c.check.message}
        {:else if c.check.status === 'mismatch'}
          {c.check.message} The statement shows a change of {formatCents(c.check.expected ?? 0, 'EUR', { sign: true })}, the operations below add up to {formatCents(c.check.found, 'EUR', { sign: true })}. Check the direction of each operation, or whether one is missing.
        {:else}
          {c.check.message} Compare the operations below with the PDF before importing.
        {/if}
      </div>
    {/each}
    {#if guessed}
      <div class="notice warn">This statement has a single amount column without signs: the direction of {guessed} operation{guessed > 1 ? 's was' : ' was'} guessed from the label. Tap ± to correct one.</div>
    {/if}

    {#if preview.alreadyImportedAt}
      <div class="notice warn">{isPdfPreview && preview.parts.length > 1 ? 'These statements were' : 'This exact file was'} already imported on {formatDay(preview.alreadyImportedAt.slice(0, 10))}.</div>
    {/if}
    {#each preview.parsed.errors as e}<div class="notice bad">{e}</div>{/each}
    {#if isPdfPreview}{#each preview.parsed.warnings as w}<div class="notice warn">{w}</div>{/each}{/if}

    {#if manuals.length}
      <div class="notice ok">
        <strong>{manuals.length} operation{manuals.length > 1 ? 's' : ''} you added by hand {manuals.length > 1 ? 'are' : 'is'} in {isPdfPreview ? 'these statements' : 'this file'}.</strong> They will be merged with the bank lines, keeping your category and note, so nothing is counted twice.
        <ul style="margin: 6px 0 0; padding-left: 18px">
          {#each manuals as r}<li>{r.match?.counterparty} ({formatCents(r.row.amount)}) is {r.info.counterparty}, {formatDay(r.info.opDate ?? r.row.date)}</li>{/each}
        </ul>
      </div>
    {/if}
    {#if possibles.length && !isPdfPreview}
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
      {#if isPdfPreview}
        <div class="field">
          <label for="target">Import into</label>
          <select id="target" bind:value={target} onchange={retarget}>
            {#each otherAccounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
            <option value="new">A new account</option>
          </select>
          {#if preview.autoMatched && target === preview.account?.id}<div class="hint">Recognized from the account number on the statement.</div>
          {:else if preview.suggested && target === preview.account?.id}<div class="hint">Your savings account without statements so far. Choose another one if it is not this account.</div>{/if}
        </div>
      {/if}
      {#if isNew || !isPdfPreview}
        <div class="field" style="margin-bottom: 0">
          <label for="acc">{!isNew ? 'Account (recognized)' : 'New account name'}</label>
          <input id="acc" bind:value={accountName} />
          {#if isNew}
            <div class="hint">Only the last 4 digits of the account number are kept.</div>
            {#if isPdfPreview}
              <label style="display: flex; gap: 10px; align-items: center; font-weight: 500; margin: 12px 0 0">
                <input type="checkbox" bind:checked={savingsType} style="width: 22px; min-height: 22px" /> This is a savings account
              </label>
            {/if}
            <div style="margin-top: 12px"><p style="font-weight: 600; font-size: 0.9rem; margin-bottom: 6px">Color in the operations list</p><AccountColor bind:value={color} label="Account color" /></div>
          {/if}
        </div>
      {/if}
    </div>

    {#if isPdfPreview}
      <div class="card" style="padding: 4px 14px">
        <h2 style="margin: 10px 0 2px">Check the operations</h2>
        <p class="hint" style="margin: 0 0 6px">Untick a line to leave it out. Tap ± if money in and money out are swapped.</p>
        <ul class="list" data-testid="pdf-rows">
          {#each preview.rows as r, i (r.fp + ':' + i)}
            <li class="tx pdfrow" style="padding: 8px 0" class:off={!r.include}>
              <input type="checkbox" aria-label="Import {r.info.counterparty}" bind:checked={r.include} disabled={r.status === 'duplicate'} style="width: 22px; min-height: 22px; flex: none" />
              <div class="main">
                <div class="name">{r.info.counterparty}</div>
                <div class="sub">{formatDay(r.row.date)} · {r.row.detail || r.row.label}</div>
                {#if r.status !== 'new'}<span class="badge {r.status === 'manual' ? 'accent' : 'warn'}">{STATUS[r.status]}</span>{/if}
              </div>
              <div class="amt num" class:in={r.amount > 0}>{formatCents(r.amount, r.row.currency, { sign: true })}</div>
              <button class="small ghost flip" aria-label="Swap money in and out for {r.info.counterparty}" disabled={r.status === 'duplicate'} onclick={() => flip(r)}>±</button>
            </li>
          {/each}
        </ul>
      </div>
    {:else if preview.months.length}
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
      <button class="block secondary" onclick={cancel}>Cancel</button>
      <button class="block" disabled={toImport === 0 || (isNew && !accountName.trim())} onclick={doImport}>
        {toImport === 0 ? 'Nothing new' : `Import ${toImport}`}
      </button>
    </div>
  {/if}
</div>

<style>
  .pdfrow { align-items: flex-start; }
  .pdfrow .sub { white-space: normal; }
  .pdfrow.off .main,
  .pdfrow.off .amt { opacity: 0.45; }
  .flip { min-width: 40px; min-height: 36px; padding: 4px 8px; font-size: 1.05rem; }
</style>
