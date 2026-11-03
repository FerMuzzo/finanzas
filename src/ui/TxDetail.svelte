<script lang="ts">
  import { app, persist, toast } from './app.svelte';
  import { formatDay } from '../core/dates';
  import { formatCents } from '../core/money';
  import { OP_LABELS, type Transaction } from '../core/model';
  import { categorizeAll, catSourceLabel, setCategoryByHand } from '../core/categorize';
  import { unlinkTransfer } from '../core/transfers';
  import { linkSeries } from '../core/recurring';
  import { deleteManual } from '../core/manual';
  import SimilarView from './SimilarView.svelte';
  import RecordElsewhere from './RecordElsewhere.svelte';
  import { canRecordElsewhere } from '../core/accounts';

  let { tx, onclose }: { tx: Transaction; onclose: () => void } = $props();

  const data = $derived(app.data!);
  const account = $derived(data.accounts.find((a) => a.id === tx.accountId));
  const other = $derived(tx.transferId ? data.transactions.find((t) => t.transferId === tx.transferId && t.id !== tx.id) : undefined);
  const otherAccount = $derived(other ? data.accounts.find((a) => a.id === other.accountId) : undefined);
  const series = $derived(tx.recurringId ? data.recurring.find((r) => r.id === tx.recurringId) : undefined);
  const expenseCats = $derived(data.categories.filter((c) => c.kind === 'expense'));
  const incomeCats = $derived(data.categories.filter((c) => c.kind === 'income'));
  const otherCats = $derived(data.categories.filter((c) => c.kind === 'savings' || c.kind === 'transfer'));
  const sameMerchant = $derived(data.transactions.filter((t) => t.merchantKey === tx.merchantKey && t.id !== tx.id).length);

  function setCategory(e: Event) {
    const v = (e.target as HTMLSelectElement).value || null;
    const n = setCategoryByHand(data, tx, v);
    linkSeries(data);
    persist();
    if (n > 0) toast(`Also applied to ${n} other operation${n > 1 ? 's' : ''} from ${tx.counterparty}`);
  }
  function saveNote(e: Event) {
    tx.note = (e.target as HTMLTextAreaElement).value.trim() || undefined;
    persist();
  }
  function unlink() {
    if (tx.transferId) unlinkTransfer(data, tx.transferId);
    categorizeAll(data);
    linkSeries(data);
    persist();
  }
  let confirmDelete = $state(false);
  let similar = $state(false);
  let recording = $state(false);
  const canRecord = $derived(canRecordElsewhere(data, tx));
  const mirrorSource = $derived(tx.mirrorOf ? data.transactions.find((t) => t.id === tx.mirrorOf) : undefined);
  function remove() {
    if (!confirmDelete) {
      confirmDelete = true;
      return;
    }
    deleteManual(data, tx.id);
    persist();
    toast('Operation deleted');
    onclose();
  }
  const fmtForeign = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
</script>

<div class="sheet-backdrop" onclick={onclose} role="presentation">
  <div class="sheet" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && onclose()} role="dialog" aria-modal="true" aria-label="Operation details" tabindex="-1">
    <div class="grip"></div>
    {#if similar}
      <SimilarView {tx} onback={() => (similar = false)} />
    {:else if recording}
      <RecordElsewhere txs={[tx]} onback={() => (recording = false)} ondone={() => (recording = false)} />
    {:else}
    <div class="row" style="align-items: flex-start">
      <div>
        <h2 style="margin-bottom: 2px">{tx.counterparty}</h2>
        <small>{OP_LABELS[tx.opType]}{tx.channel ? ' · ' + tx.channel : ''}{tx.online ? ' · online' : ''}{tx.place ? ' · ' + tx.place : ''}</small>
      </div>
      <div class="num" style="font-size: 1.3rem; font-weight: 700" class:in={tx.amount > 0}>{formatCents(tx.amount, tx.currency, { sign: true })}</div>
    </div>

    {#if tx.transferId}
      <div class="notice ok" style="margin-top: 12px">
        Transfer between your accounts{otherAccount ? ' (other side in ' + otherAccount.name + ')' : ''}. Not counted as income or spending.
        <button class="small ghost" onclick={unlink}>Not a transfer between my accounts</button>
      </div>
    {:else if tx.ownTransferHint}
      <div class="notice warn" style="margin-top: 12px">This looks like a transfer to or from yourself. Record it in the account {tx.amount < 0 ? 'it went to' : 'it came from'} below, or choose the category "Transfer between my accounts" to leave it out of totals.</div>
    {/if}
    {#if canRecord}
      <button class="block secondary" style="margin-top: 12px" onclick={() => (recording = true)}>{tx.amount < 0 ? 'Moved to another of my accounts' : 'Came from another of my accounts'}</button>
    {/if}
    {#if series}
      <div class="notice ok" style="margin-top: 12px">Part of your regular payments: {series.name}.</div>
    {/if}

    <div class="card flat" style="margin-top: 12px">
      <div class="field">
        <label for="cat">Category</label>
        <select id="cat" value={tx.categoryId ?? ''} onchange={setCategory}>
          <option value="">Not categorized</option>
          <optgroup label="Spending">{#each expenseCats as c}<option value={c.id}>{c.name}</option>{/each}</optgroup>
          <optgroup label="Income">{#each incomeCats as c}<option value={c.id}>{c.name}</option>{/each}</optgroup>
          <optgroup label="Other">{#each otherCats as c}<option value={c.id}>{c.name}</option>{/each}</optgroup>
        </select>
        <div class="hint">
          {#if tx.categoryId}{catSourceLabel(tx.catSource)}.{/if}
          {#if sameMerchant > 0}Your choice also applies to the {sameMerchant} other operation{sameMerchant > 1 ? 's' : ''} from this merchant, except those you set by hand.{/if}
        </div>
      </div>
      <div class="field" style="margin-bottom: 0">
        <label for="note">Note</label>
        <textarea id="note" rows="2" value={tx.note ?? ''} onchange={saveNote}></textarea>
      </div>
    </div>

    <dl class="kv card flat">
      <dt>Account</dt><dd><span class="accdot" style="background: var(--acc-{account?.color ?? 1})"></span>{account?.name}</dd>
      {#if tx.source === 'manual' && mirrorSource}<dt>Source</dt><dd>Recorded from {mirrorSource.counterparty} ({data.accounts.find((a) => a.id === mirrorSource.accountId)?.name}), waiting for the statement</dd>
      {:else if tx.source === 'manual'}<dt>Source</dt><dd>Added by hand, waiting for the bank file</dd>{:else if tx.mergedFromManual}<dt>Source</dt><dd>Added by hand, confirmed by the bank file</dd>{/if}
      <dt>Booked on</dt><dd>{formatDay(tx.date)}</dd>
      {#if tx.opDate && tx.opDate !== tx.date}<dt>Paid on</dt><dd>{formatDay(tx.opDate)}</dd>{/if}
      {#if tx.foreign}<dt>Original amount</dt><dd>{fmtForeign(tx.foreign.amount)} {tx.foreign.currency}{tx.foreign.country ? ', ' + tx.foreign.country : ''}</dd>{/if}
      {#if tx.foreign?.rate}<dt>Rate</dt><dd>1 EUR = {String(tx.foreign.rate).replace('.', ',')} {tx.foreign.currency}</dd>{/if}
      {#if tx.motif}<dt>Reason</dt><dd>{tx.motif}</dd>{/if}
      {#if tx.creditorId}<dt>Creditor ID</dt><dd>{tx.creditorId}</dd>{/if}
      {#if tx.bankCategory}<dt>Bank category</dt><dd>{tx.bankCategory}</dd>{/if}
    </dl>

    {#if tx.detail}
      <p class="hint" style="margin-bottom: 4px">Bank text</p>
      <div class="raw">{tx.detail}</div>
    {/if}
    {#if tx.source === 'manual'}
      <button class="block danger" style="margin-top: 16px" onclick={remove}>{confirmDelete ? 'Tap again to delete' : 'Delete this operation'}</button>
    {/if}

    <button class="block secondary" style="margin-top: 12px" onclick={() => (similar = true)}>Find similar operations</button>
    {/if}
    <button class="block secondary" style="margin-top: 12px" onclick={onclose}>Close</button>
  </div>
</div>
