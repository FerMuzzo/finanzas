<script lang="ts">
  import { app, showOperations } from '../app.svelte';
  import { formatMonth, formatShortMonth, monthOf, todayIso } from '../../core/dates';
  import { formatCents } from '../../core/money';
  import { completeMonths, fixedVersusVariable, spendingByCategory, topMerchants, transferFlows } from '../../core/summary';
  import AccountChips from '../AccountChips.svelte';

  const data = $derived(app.data!);
  let mode = $state<'month' | 'average'>('month');
  let span = $state(3);
  let open = $state<string | null>(null);

  const accountIds = $derived(app.spendingAccounts);
  const inAccounts = $derived(data.transactions.filter((t) => !accountIds.length || accountIds.includes(t.accountId)));
  const allMonths = $derived([...new Set(inAccounts.map((t) => monthOf(t.date)))].sort().reverse());
  const full = $derived(completeMonths(data, todayIso(), accountIds));
  let month = $state('');
  const selMonth = $derived(month && allMonths.includes(month) ? month : full[0] ?? allMonths[0] ?? '');
  const spans = $derived([3, 6, 12].filter((n, i) => i === 0 || full.length >= n));
  const avgMonths = $derived(full.slice(0, Math.min(span, full.length)));
  const months = $derived(mode === 'month' ? [selMonth] : avgMonths);
  const average = $derived(mode === 'average');

  const cats = $derived(spendingByCategory(data, months, { average, accountIds }));
  const total = $derived(cats.reduce((s, c) => s + c.amount, 0));
  const max = $derived(Math.max(1, ...cats.map((c) => c.amount)));

  // Reference for a single month: the average of up to 3 full months before it
  const refMonths = $derived(full.filter((m) => m < selMonth).slice(0, 3));
  const ref = $derived(mode === 'month' && refMonths.length >= 2 ? new Map(spendingByCategory(data, refMonths, { average: true, accountIds }).map((c) => [c.categoryId, c.amount])) : null);
  const refTotal = $derived(ref ? [...ref.values()].reduce((s, x) => s + x, 0) : 0);

  const fv = $derived(fixedVersusVariable(data, months, average, accountIds));
  const merchants = $derived(topMerchants(data, months, { limit: 8, average, accountIds }));
  const moved = $derived(transferFlows(data, months, { average, accountIds }));
  const accName = (id: string | null, other?: string) => (id ? data.accounts.find((a) => a.id === id)?.name ?? 'an account' : other ? `${other} (not in the app)` : 'outside the app');
  const accColor = (id: string | null) => (id ? data.accounts.find((a) => a.id === id)?.color ?? 1 : 0);
  const hasSeries = $derived(data.recurring.some((r) => r.status === 'confirmed'));

  const catName = (id: string | null) => (id ? data.categories.find((c) => c.id === id)?.name ?? id : 'Not categorized');
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

  function delta(id: string | null, amount: number): { text: string; cls: string } | null {
    if (!ref) return null;
    const r = ref.get(id) ?? 0;
    if (r === 0) return amount > 0 ? { text: 'new this month', cls: 'up' } : null;
    const d = Math.round(((amount - r) / r) * 100);
    if (Math.abs(d) < 10) return { text: `usual (avg ${formatCents(r)})`, cls: '' };
    return { text: `${d > 0 ? '▲' : '▼'} ${Math.abs(d)}% vs avg ${formatCents(r)}`, cls: d > 0 ? 'up' : 'down' };
  }

  function perMonth(n: number): string {
    if (n < 0.75) return 'less than one payment per month';
    const r = Math.round(n);
    return `about ${r} payment${r === 1 ? '' : 's'} per month`;
  }

  function seeOps(id: string | null) {
    showOperations({ categoryId: id ?? '__none', month: mode === 'month' ? selMonth : '', accountIds: [...accountIds] });
  }
  function seeTransfers(fromId: string | null, toId: string | null) {
    const ids = [fromId ?? toId].filter(Boolean) as string[];
    showOperations({ categoryId: '__transfers', month: mode === 'month' ? selMonth : '', accountIds: ids });
  }
</script>

<div class="page">
  <div class="topbar"><h1>Spending</h1></div>
  <AccountChips bind:selected={app.spendingAccounts} label="Accounts in this view" />

  {#if allMonths.length === 0}
    <div class="card"><p class="muted" style="margin: 0">{accountIds.length ? 'No operations in the chosen accounts.' : 'Import a bank file to see where your money goes.'}</p></div>
  {:else}
    <div class="seg" role="tablist">
      <button class:on={mode === 'month'} onclick={() => (mode = 'month')} role="tab" aria-selected={mode === 'month'}>One month</button>
      <button class:on={mode === 'average'} onclick={() => (mode = 'average')} role="tab" aria-selected={mode === 'average'}>Monthly average</button>
    </div>

    {#if mode === 'month'}
      <div class="chips" style="margin-bottom: 12px">
        {#each allMonths.slice(0, 12) as m}
          <button class="chip" class:on={m === selMonth} onclick={() => (month = m)}>{formatShortMonth(m)} {m.slice(2, 4)}</button>
        {/each}
      </div>
    {:else}
      <div class="chips" style="margin-bottom: 12px">
        {#each spans as n}
          <button class="chip" class:on={span === n} onclick={() => (span = n)}>Last {Math.min(n, full.length)} months</button>
        {/each}
      </div>
    {/if}

    <div class="card">
      <div class="muted" style="font-size: 0.9rem">
        {#if mode === 'month'}Spent in {formatMonth(selMonth)}{#if selMonth === todayIso().slice(0, 7)} (so far){/if}
        {:else}Average spending per month{#if avgMonths.length}, {formatShortMonth(avgMonths[avgMonths.length - 1])} to {formatShortMonth(avgMonths[0])}{/if}{/if}
      </div>
      <div class="hero num">{formatCents(total)}</div>
      {#if mode === 'month' && refTotal}
        {@const d = Math.round(((total - refTotal) / refTotal) * 100)}
        <div class="delta" class:up={d >= 10} class:down={d <= -10}>{d >= 0 ? '▲' : '▼'} {Math.abs(d)}% compared with your average of {formatCents(refTotal)}</div>
      {/if}
      {#if mode === 'average' && avgMonths.length < span}
        <p class="hint" style="margin: 6px 0 0">Only {avgMonths.length} complete month{avgMonths.length > 1 ? 's' : ''} of data so far.</p>
      {/if}
    </div>

    <div class="card">
      <h2>By category</h2>
      {#if cats.length === 0}<p class="muted">No spending in this period.</p>{/if}
      <ul class="list">
        {#each cats as c (c.categoryId)}
          {@const dl = delta(c.categoryId, c.amount)}
          <li>
            <button class="catrow" onclick={() => (open = open === c.categoryId ? null : c.categoryId)} aria-expanded={open === c.categoryId}>
              <div class="top">
                <span class="name" class:muted={!c.categoryId}>{catName(c.categoryId)}</span>
                <span class="num" style="font-weight: 650">{formatCents(c.amount)}</span>
              </div>
              <div class="top" style="margin-top: 2px">
                <span class="delta {dl?.cls ?? ''}">{dl ? dl.text : average ? perMonth(c.count) : `${c.count} payment${c.count === 1 ? '' : 's'}`}</span>
                <span class="delta">{pct(c.amount, total)}%</span>
              </div>
              <div class="track"><div class="fill" style="width: {(c.amount / max) * 100}%"></div></div>
            </button>
            {#if open === c.categoryId}
              <div class="sub-list">
                {#each topMerchants(data, months, { categoryId: c.categoryId, limit: 6, average }) as m}
                  <div class="row"><span>{m.name}</span><span class="num">{formatCents(m.amount)}</span></div>
                {/each}
                <button class="small ghost" style="padding-left: 0" onclick={() => seeOps(c.categoryId)}>{c.categoryId ? 'See these operations' : 'Categorize these operations'}</button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </div>

    <div class="card">
      <h2>Regular payments and everyday spending</h2>
      {#if hasSeries}
        <div class="split" role="img" aria-label="Regular {formatCents(fv.fixed)}, everyday {formatCents(fv.variable)}">
          <div class="a" style="flex: {fv.fixed || 0.0001}"></div>
          <div class="b" style="flex: {fv.variable || 0.0001}"></div>
        </div>
        <div class="row"><span><i class="legend-dot" style="background: var(--c-spend)"></i>Regular payments</span><span class="num">{formatCents(fv.fixed)}</span></div>
        <div class="row" style="margin-top: 4px"><span><i class="legend-dot" style="background: var(--c-income)"></i>Everything else</span><span class="num">{formatCents(fv.variable)}</span></div>
        <p class="hint" style="margin: 8px 0 0">Regular payments are hard to change quickly; savings usually come from the everyday part first.</p>
      {:else}
        <p class="muted">Confirm your regular payments to see how much of your spending is committed every month.</p>
        <button class="secondary" onclick={() => (app.tab = 'regular')}>Review regular payments</button>
      {/if}
    </div>

    <div class="card" data-testid="transfers-card">
      <div class="row"><h2 style="margin: 0">Between your accounts</h2><span class="num" style="font-weight: 650">{formatCents(moved.total)}</span></div>
      <p class="hint" style="margin: 2px 0 8px">{average ? 'Moved per month on average' : 'Moved'} from one of your accounts to another. Not counted as spending or income.</p>
      {#if moved.flows.length === 0}
        <p class="muted" style="margin: 0">No transfers between your accounts in this period.</p>
      {:else}
        <ul class="list">
          {#each moved.flows as f (f.key)}
            <li>
              <button class="catrow flow" onclick={() => seeTransfers(f.fromId, f.toId)}>
                <div class="top">
                  <span class="name">
                    {#if f.fromId}<span class="accdot" style="background: var(--acc-{accColor(f.fromId)})"></span>{/if}{accName(f.fromId, f.otherName)}
                    <span class="muted"> to </span>
                    {#if f.toId}<span class="accdot" style="background: var(--acc-{accColor(f.toId)})"></span>{/if}{accName(f.toId, f.otherName)}
                  </span>
                  <span class="num" style="font-weight: 650">{formatCents(f.amount)}</span>
                </div>
                <span class="delta">{average ? perMonth(f.count).replace('payment', 'transfer') : `${f.count} transfer${f.count === 1 ? '' : 's'}`}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="card">
      <h2>Where you spend the most</h2>
      <ul class="list">
        {#each merchants as m (m.key)}
          <li class="row" style="padding: 8px 0">
            <span>{m.name} <small>· {catName(m.categoryId)}</small></span>
            <span class="num">{formatCents(m.amount)}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
