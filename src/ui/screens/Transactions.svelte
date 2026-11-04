<script lang="ts">
  import { app, persist, toast } from '../app.svelte';
  import { setCategoryForMany } from '../../core/categorize';
  import { linkSeries } from '../../core/recurring';
  import RecordElsewhere from '../RecordElsewhere.svelte';
  import CategorySelect from '../CategorySelect.svelte';
  import SimilarPicker from '../SimilarPicker.svelte';
  import { formatDay, formatMonth, monthOf } from '../../core/dates';
  import { formatCents } from '../../core/money';
  import { OP_LABELS, type Transaction } from '../../core/model';
  import { normalizeKey } from '../../core/text';
  import Icon from '../Icon.svelte';
  import TxDetail from '../TxDetail.svelte';
  import AccountChips from '../AccountChips.svelte';
  import { isInternal } from '../../core/summary';

  const data = $derived(app.data!);
  let selected = $state<Transaction | null>(null);
  let limit = $state(150);

  const months = $derived([...new Set(data.transactions.map((t) => monthOf(t.date)))].sort().reverse());
  const onlyIds = $derived(app.txFilter.ids.length ? new Set(app.txFilter.ids) : null);
  const filtered = $derived.by(() => {
    const q = normalizeKey(app.txFilter.query);
    return data.transactions.filter(
      (t) =>
        (!onlyIds || onlyIds.has(t.id)) &&
        (!app.txFilter.accountIds.length || app.txFilter.accountIds.includes(t.accountId)) &&
        (!app.txFilter.month || monthOf(t.date) === app.txFilter.month) &&
        (!app.txFilter.categoryId ||
          (app.txFilter.categoryId === '__none'
            ? !t.categoryId && !t.transferId
            : app.txFilter.categoryId === '__transfers'
              ? isInternal(t)
              : t.categoryId === app.txFilter.categoryId)) &&
        (!q || normalizeKey(t.counterparty + ' ' + t.detail + ' ' + (t.note ?? '')).includes(q)),
    );
  });
  const totals = $derived.by(() => {
    let inc = 0, out = 0, movedIn = 0, movedOut = 0;
    for (const t of filtered) {
      if (isInternal(t)) {
        if (t.amount >= 0) movedIn += t.amount; else movedOut += -t.amount;
        continue;
      }
      if (t.amount >= 0) inc += t.amount; else out += -t.amount;
    }
    return { inc, out, movedIn, movedOut };
  });
  const groups = $derived.by(() => {
    const out: { day: string; items: Transaction[] }[] = [];
    for (const t of filtered.slice(0, limit)) {
      const last = out[out.length - 1];
      if (last && last.day === t.date) last.items.push(t);
      else out.push({ day: t.date, items: [t] });
    }
    return out;
  });
  const catName = (id: string | null) => (id ? data.categories.find((c) => c.id === id)?.name : undefined);
  const multiAccount = $derived(data.accounts.length > 1);
  // For a transfer between your accounts, the account on the other side
  const otherSide = $derived.by(() => {
    const byLink = new Map<string, Transaction[]>();
    for (const t of data.transactions) if (t.transferId) byLink.set(t.transferId, [...(byLink.get(t.transferId) ?? []), t]);
    const out = new Map<string, string>();
    for (const pair of byLink.values()) {
      if (pair.length !== 2) continue;
      out.set(pair[0].id, pair[1].accountId);
      out.set(pair[1].id, pair[0].accountId);
    }
    return out;
  });
  // Selecting several operations to change them together
  const picked = $derived(new Set(app.selection ?? []));
  const pickedTxs = $derived(app.selection ? data.transactions.filter((t) => picked.has(t.id)) : []);
  let bulkCat = $state<string | null>(''); // '' nothing chosen yet, null for "Not categorized"
  let recording = $state(false);
  function startSelect() {
    app.selection = [];
    bulkCat = '';
  }
  function stopSelect() {
    app.selection = null;
  }
  let lastPicked = $state<string | null>(null); // the operation just ticked offers its similar ones
  let similarFor = $state<Transaction | null>(null);
  function toggle(t: Transaction) {
    if (!app.selection) return;
    if (picked.has(t.id)) {
      app.selection = app.selection.filter((id) => id !== t.id);
      if (lastPicked === t.id) lastPicked = null;
    } else {
      app.selection = [...app.selection, t.id];
      lastPicked = t.id;
    }
  }
  const hiddenPicked = $derived(app.selection ? app.selection.length - filtered.filter((t) => picked.has(t.id)).length : 0);
  const allShownPicked = $derived(filtered.length > 0 && filtered.every((t) => picked.has(t.id)));
  function pickAll() {
    app.selection = allShownPicked ? [] : filtered.map((t) => t.id);
  }
  function applyCategory() {
    if (!app.selection?.length || bulkCat === '') return;
    const id = bulkCat;
    const r = setCategoryForMany(data, app.selection, id);
    linkSeries(data);
    persist();
    const name = id ? data.categories.find((c) => c.id === id)?.name : 'Not categorized';
    toast(`${r.set} set to ${name}${r.others ? `, ${r.others} more of the same merchants followed` : ''}`);
    app.selection = [];
    bulkCat = '';
  }
  function clearIds() {
    app.txFilter.ids = [];
    app.txFilter.idsLabel = '';
  }

  function subLine(t: Transaction): string {
    const other = otherSide.get(t.id);
    const what = other ? `${t.amount < 0 ? 'To' : 'From'} ${accountName(other)}` : catName(t.categoryId) ?? OP_LABELS[t.opType];
    return what + (t.foreign && t.foreign.currency !== 'EUR' ? ' · ' + t.foreign.currency : '') + (multiAccount ? ' · ' + accountName(t.accountId) : '');
  }
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? '';
  const accountColor = (id: string) => data.accounts.find((a) => a.id === id)?.color ?? 1;
</script>

<div class="page" class:selecting={!!app.selection}>
  <div class="topbar">
    <h1>Operations</h1>
    <div>
      {#if app.selection}
        <button class="small ghost" onclick={stopSelect}>Done</button>
      {:else}
        <button class="small ghost" onclick={startSelect} data-testid="select-start">Select</button>
        <button class="ghost" onclick={() => (app.tab = 'import')} aria-label="Import a bank file"><Icon name="upload" /></button>
      {/if}
    </div>
  </div>
  {#if app.txFilter.ids.length}
    <div class="chips" style="margin-bottom: 10px">
      <button class="chip on" onclick={clearIds} aria-label="Show all operations again">{app.txFilter.idsLabel || `${app.txFilter.ids.length} chosen operations`} ✕</button>
    </div>
  {/if}

  <div class="field" style="position: relative">
    <span style="position: absolute; left: 12px; top: 12px; color: var(--muted)"><Icon name="search" size={20} /></span>
    <input type="search" placeholder="Search a name, a word, a note" bind:value={app.txFilter.query} style="padding-left: 40px" />
  </div>
  <div class="row" style="gap: 8px; margin-bottom: 8px">
    <select bind:value={app.txFilter.month} aria-label="Month">
      <option value="">All months</option>
      {#each months as m}<option value={m}>{formatMonth(m)}</option>{/each}
    </select>

  </div>
  <select bind:value={app.txFilter.categoryId} aria-label="Category" style="margin-bottom: 8px">
    <option value="">All categories</option>
    <option value="__none">Not categorized yet</option>
    <option value="__transfers">Transfers between my accounts</option>
    {#each data.categories.filter((c) => c.id !== 'own_transfer') as c}<option value={c.id}>{c.name}</option>{/each}
  </select>
  <AccountChips bind:selected={app.txFilter.accountIds} />
  <p class="hint" style="margin-bottom: 0">{filtered.length} operation{filtered.length === 1 ? "" : "s"} · in <span class="num in">{formatCents(totals.inc)}</span> · out <span class="num">{formatCents(totals.out)}</span></p>
  {#if totals.movedIn || totals.movedOut}
    <p class="hint" style="margin-top: 2px">Between your accounts: in <span class="num">{formatCents(totals.movedIn)}</span> · out <span class="num">{formatCents(totals.movedOut)}</span>, not counted above</p>
  {/if}

  {#if filtered.length === 0}
    <div class="card"><p class="muted" style="margin: 0">Nothing matches.</p></div>
  {/if}

  {#each groups as g (g.day)}
    <div class="dayhead">{formatDay(g.day)}</div>
    <div class="card" style="padding: 0 14px">
      <ul class="list">
        {#each g.items as t (t.id)}
          <li>
            <button class="tx" class:picked={picked.has(t.id)} onclick={() => (app.selection ? toggle(t) : (selected = t))} aria-pressed={app.selection ? picked.has(t.id) : undefined}>
              {#if app.selection}<span class="tick" class:on={picked.has(t.id)} aria-hidden="true">{#if picked.has(t.id)}<Icon name="check" size={16} />{/if}</span>{/if}
              <span class="accbar" style="background: var(--acc-{accountColor(t.accountId)})" title={accountName(t.accountId)}></span>
              <div class="main">
                <div class="name">{t.counterparty}</div>
                <div class="sub">
                  {subLine(t)}
                </div>
              </div>
              <div style="text-align: right">
                <div class="amt num" class:in={t.amount > 0}>{formatCents(t.amount, t.currency, { sign: true })}</div>
                {#if t.transferId}<span class="badge accent">own transfer</span>{:else if t.ownTransferHint}<span class="badge warn">to yourself?</span>{:else if t.source === 'manual'}<span class="badge">added by hand</span>{/if}
              </div>
            </button>
            {#if app.selection && lastPicked === t.id && picked.has(t.id)}
              <button class="small ghost similar-link" onclick={() => (similarFor = t)} data-testid="pick-similar">
                <Icon name="search" size={16} /> Find similar operations
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/each}

  {#if filtered.length > limit}
    <button class="block secondary" onclick={() => (limit += 200)}>Show more</button>
  {/if}
</div>

{#if selected}
  <TxDetail tx={selected} onclose={() => (selected = null)} />
{/if}

{#if app.selection}
  <div class="selbar" data-testid="selbar">
    <div class="row">
      <span><strong>{app.selection.length} selected</strong>{#if hiddenPicked > 0}<small class="muted"> · {hiddenPicked} not in this list</small>{/if}</span>
      <button class="small ghost" onclick={pickAll}>{allShownPicked ? 'Select none' : `Select all ${filtered.length}`}</button>
    </div>
    <div class="row" style="gap: 8px; margin-top: 6px">
      <div style="flex: 1; min-width: 0"><CategorySelect bind:value={bulkCat} placeholder="Choose a category" label="Category for the selected operations" disabled={!app.selection.length} /></div>
      <button disabled={!app.selection.length || bulkCat === ''} onclick={applyCategory}>Apply</button>
    </div>
    {#if app.selection.length && data.accounts.length > 1}
      <button class="small ghost" style="padding-left: 0; margin-top: 4px" onclick={() => (recording = true)}>Record in another of my accounts</button>
    {/if}
  </div>
{/if}

{#if similarFor}
  <SimilarPicker tx={similarFor} onclose={() => (similarFor = null)} />
{/if}

{#if recording}
  <div class="sheet-backdrop" onclick={() => (recording = false)} role="presentation">
    <div class="sheet" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && (recording = false)} role="dialog" aria-modal="true" aria-label="Record in another account" tabindex="-1">
      <div class="grip"></div>
      <RecordElsewhere
        txs={pickedTxs}
        onback={() => (recording = false)}
        ondone={() => {
          recording = false;
          app.selection = [];
        }}
      />
    </div>
  </div>
{/if}

<style>
  .tick { flex: none; width: 24px; height: 24px; border-radius: 7px; border: 2px solid var(--line); display: grid; place-items: center; color: var(--accent-ink); }
  .tick.on { background: var(--accent); border-color: var(--accent); }
  .page.selecting .tx { padding-left: 8px; padding-right: 8px; border-radius: 10px; }
  .tx.picked { background: var(--accent-soft); }
  .similar-link { display: flex; align-items: center; gap: 6px; margin: -4px 0 8px 40px; padding: 4px 8px; min-height: 34px; }
  .selbar {
    position: fixed; left: 0; right: 0; z-index: 25; bottom: calc(var(--nav-h) + env(safe-area-inset-bottom));
    background: var(--surface); border-top: 1px solid var(--line); box-shadow: 0 -4px 14px rgba(0, 0, 0, 0.08);
    padding: 10px 16px; max-width: 640px; margin: 0 auto;
  }
  .page.selecting { padding-bottom: calc(var(--nav-h) + 150px + env(safe-area-inset-bottom)); }
</style>
