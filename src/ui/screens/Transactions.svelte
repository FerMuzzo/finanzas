<script lang="ts">
  import { app } from '../app.svelte';
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
  const filtered = $derived.by(() => {
    const q = normalizeKey(app.txFilter.query);
    return data.transactions.filter(
      (t) =>
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
  function subLine(t: Transaction): string {
    const other = otherSide.get(t.id);
    const what = other ? `${t.amount < 0 ? 'To' : 'From'} ${accountName(other)}` : catName(t.categoryId) ?? OP_LABELS[t.opType];
    return what + (t.foreign && t.foreign.currency !== 'EUR' ? ' · ' + t.foreign.currency : '') + (multiAccount ? ' · ' + accountName(t.accountId) : '');
  }
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? '';
  const accountColor = (id: string) => data.accounts.find((a) => a.id === id)?.color ?? 1;
</script>

<div class="page">
  <div class="topbar">
    <h1>Operations</h1>
    <button class="ghost" onclick={() => (app.tab = 'import')} aria-label="Import a bank file"><Icon name="upload" /></button>
  </div>

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
            <button class="tx" onclick={() => (selected = t)}>
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
