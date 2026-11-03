<script lang="ts">
  import { app } from '../app.svelte';
  import { formatMonth, formatShortMonth } from '../../core/dates';
  import { formatCents } from '../../core/money';
  import {
    allMonths, applyFilter, balanceHistory, byAccount, byCategory, byMerchant, byWeekday,
    monthlyByCategory, monthlyTotals, monthPace, monthsBetween, sizeDistribution, WEEKDAYS, type ChartFilter,
  } from '../../core/analytics';
  import { chartState as st, CHARTS, type ChartId } from '../charts.svelte';
  import BarChart from '../charts/BarChart.svelte';
  import LineChart from '../charts/LineChart.svelte';
  import HBarChart from '../charts/HBarChart.svelte';

  const data = $derived(app.data!);
  const months = $derived(allMonths(data));
  const lastMonth = $derived(months[months.length - 1] ?? '');

  const range = $derived.by(() => {
    if (!months.length) return { from: '', to: '' };
    if (st.period === 'all') return { from: months[0], to: lastMonth };
    if (st.period === 'custom') {
      const from = st.from && months.includes(st.from) ? st.from : months[0];
      const to = st.to && months.includes(st.to) ? st.to : lastMonth;
      return from <= to ? { from, to } : { from: to, to: from };
    }
    const n = st.period === 'p3' ? 3 : st.period === 'p6' ? 6 : 12;
    return { from: months[Math.max(0, months.length - n)], to: lastMonth };
  });
  const span = $derived(monthsBetween(range.from, range.to));
  const filter = $derived<ChartFilter>({
    from: range.from, to: range.to, accountIds: st.accountIds, categoryIds: st.categoryIds,
    kind: st.kind, query: st.query, regular: st.regular,
  });
  const items = $derived(applyFilter(data, filter));
  const total = $derived(items.reduce((s, it) => s + it.value, 0));
  const biggest = $derived(items.reduce((m, it) => (it.value > (m?.value ?? 0) ? it : m), null as (typeof items)[number] | null));
  const usedCategories = $derived(
    data.categories.filter((c) => data.transactions.some((t) => t.categoryId === c.id && c.kind !== 'transfer')),
  );
  const hasUncategorized = $derived(data.transactions.some((t) => !t.categoryId && !t.transferId));

  const mainColor = $derived(st.kind === 'expense' ? 'var(--c-spend)' : 'var(--c-income)');
  const monthLabels = $derived(span.map((m) => formatShortMonth(m)));
  const monthLong = $derived(span.map((m) => formatMonth(m)));
  const money = (v: number) => formatCents(v);
  const slot = (i: number) => (i < 6 ? `var(--acc-${i + 1})` : 'var(--muted)');
  const accColor = (id: string) => `var(--acc-${data.accounts.find((a) => a.id === id)?.color ?? 1})`;

  const paceMonth = $derived(st.paceMonth && span.includes(st.paceMonth) ? st.paceMonth : span[span.length - 1] ?? '');

  function toggle<T>(list: T[], v: T): T[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }
  function toggleChart(id: ChartId) {
    st.shown = st.shown.includes(id) ? st.shown.filter((x) => x !== id) : CHARTS.map((c) => c.id).filter((c) => st.shown.includes(c) || c === id);
  }
  function drillCategory(id: string) {
    st.categoryIds = [id];
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const filtersActive = $derived(st.accountIds.length + st.categoryIds.length + (st.query ? 1 : 0) + (st.regular !== 'all' ? 1 : 0));
</script>

<div class="page">
  <div class="topbar"><h1>Charts</h1></div>

  {#if !months.length}
    <div class="card"><p class="muted" style="margin: 0">Import a bank file to draw charts.</p></div>
  {:else}
    <div class="seg" role="tablist">
      <button class:on={st.kind === 'expense'} role="tab" aria-selected={st.kind === 'expense'} onclick={() => { st.kind = 'expense'; st.categoryIds = []; }}>Spending</button>
      <button class:on={st.kind === 'income'} role="tab" aria-selected={st.kind === 'income'} onclick={() => { st.kind = 'income'; st.categoryIds = []; }}>Income</button>
    </div>

    <div class="chips" style="margin-bottom: 10px">
      {#each [['p3', '3 months'], ['p6', '6 months'], ['p12', '12 months'], ['all', 'All'], ['custom', 'Custom']] as [id, label]}
        <button class="chip" class:on={st.period === id} onclick={() => (st.period = id as typeof st.period)}>{label}</button>
      {/each}
    </div>
    {#if st.period === 'custom'}
      <div class="row" style="gap: 8px; margin-bottom: 10px">
        <select aria-label="From" value={range.from} onchange={(e) => (st.from = (e.target as HTMLSelectElement).value)}>
          {#each months as m}<option value={m}>{formatMonth(m)}</option>{/each}
        </select>
        <select aria-label="To" value={range.to} onchange={(e) => (st.to = (e.target as HTMLSelectElement).value)}>
          {#each months as m}<option value={m}>{formatMonth(m)}</option>{/each}
        </select>
      </div>
    {/if}

    <div class="card">
      <button class="row ghost" style="width: 100%; padding: 0; min-height: 0; color: var(--text)" onclick={() => (st.showFilters = !st.showFilters)} aria-expanded={st.showFilters}>
        <h2 style="margin: 0">Filters{filtersActive ? ` (${filtersActive})` : ''}</h2>
        <span class="muted">{st.showFilters ? 'Hide' : 'Show'}</span>
      </button>
      {#if st.showFilters}
        <div style="margin-top: 12px">
          <p class="flabel">Accounts</p>
          <div class="chips wrap">
            <button class="chip" class:on={!st.accountIds.length} onclick={() => (st.accountIds = [])}>All</button>
            {#each data.accounts as a (a.id)}
              <button class="chip" class:on={st.accountIds.includes(a.id)} onclick={() => (st.accountIds = toggle(st.accountIds, a.id))}>
                <span class="accdot" style="background: var(--acc-{a.color ?? 1})"></span>{a.name}
              </button>
            {/each}
          </div>
          <p class="flabel">Categories</p>
          <div class="chips wrap">
            <button class="chip" class:on={!st.categoryIds.length} onclick={() => (st.categoryIds = [])}>All</button>
            {#each usedCategories.filter((c) => (st.kind === 'expense' ? c.kind === 'expense' || c.kind === 'savings' : c.kind === 'income')) as c (c.id)}
              <button class="chip" class:on={st.categoryIds.includes(c.id)} onclick={() => (st.categoryIds = toggle(st.categoryIds, c.id))}>{c.name}</button>
            {/each}
            {#if hasUncategorized}
              <button class="chip" class:on={st.categoryIds.includes('__none')} onclick={() => (st.categoryIds = toggle(st.categoryIds, '__none'))}>Not categorized</button>
            {/if}
          </div>
          <p class="flabel">Regular payments</p>
          <div class="seg" role="tablist" style="margin-bottom: 8px">
            <button class:on={st.regular === 'all'} onclick={() => (st.regular = 'all')}>All</button>
            <button class:on={st.regular === 'only'} onclick={() => (st.regular = 'only')}>Only regular</button>
            <button class:on={st.regular === 'exclude'} onclick={() => (st.regular = 'exclude')}>Without</button>
          </div>
          <input type="search" placeholder="Name or word, for example carrefour" bind:value={st.query} aria-label="Search" />
          {#if filtersActive}
            <button class="small ghost" style="padding-left: 0; margin-top: 6px" onclick={() => { st.accountIds = []; st.categoryIds = []; st.query = ''; st.regular = 'all'; }}>Clear filters</button>
          {/if}
        </div>
      {/if}
    </div>

    <div class="card">
      <div class="grid3">
        <div class="stat"><div class="label">{st.kind === 'expense' ? 'Spent' : 'Received'}</div><div class="value num">{money(total)}</div></div>
        <div class="stat"><div class="label">Per month</div><div class="value num">{money(span.length ? Math.round(total / span.length) : 0)}</div></div>
        <div class="stat"><div class="label">Operations</div><div class="value num">{items.length}</div></div>
      </div>
      <p class="hint" style="margin: 8px 0 0">
        {monthLong[0]}{span.length > 1 ? ' to ' + monthLong[monthLong.length - 1] : ''}.
        {#if biggest}Largest: {biggest.t.counterparty}, {money(biggest.value)}.{/if}
      </p>
    </div>

    <p class="flabel" style="margin-left: 2px">Charts to show</p>
    <div class="chips wrap" style="margin-bottom: 12px">
      {#each CHARTS as c}
        <button class="chip" class:on={st.shown.includes(c.id)} onclick={() => toggleChart(c.id)} aria-pressed={st.shown.includes(c.id)}>{c.label}</button>
      {/each}
    </div>

    {#if !items.length}
      <div class="card"><p class="muted" style="margin: 0">Nothing matches these filters.</p></div>
    {/if}

    {#each st.shown as id (id)}
      {#if id === 'monthly' && items.length}
        <div class="card">
          <h2>{st.kind === 'expense' ? 'Spending' : 'Income'} month by month</h2>
          <BarChart labels={monthLabels} readoutLabels={monthLong} series={[{ name: st.kind === 'expense' ? 'Spending' : 'Income', values: monthlyTotals(items, span), color: mainColor }]} format={money} />
        </div>
      {:else if id === 'stacked' && items.length}
        <div class="card">
          <h2>Categories over time</h2>
          <BarChart stacked labels={monthLabels} readoutLabels={monthLong} series={monthlyByCategory(data, items, span, 6).map((s, i) => ({ name: s.name, values: s.values, color: slot(i) }))} format={money} height={190} />
        </div>
      {:else if id === 'categories' && items.length}
        <div class="card">
          <h2>By category</h2>
          <p class="hint" style="margin-top: -4px">Tap a category to show only it.</p>
          <HBarChart rows={byCategory(data, items).map((r) => ({ ...r, sub: `${r.count} operations · ${money(Math.round(r.value / Math.max(1, span.length)))} per month` }))} format={money} onselect={drillCategory} />
        </div>
      {:else if id === 'merchants' && items.length}
        <div class="card">
          <h2>Top places</h2>
          <HBarChart rows={byMerchant(items, 12).map((r) => ({ ...r, sub: `${r.count} times · ${money(Math.round(r.value / r.count))} on average` }))} format={money} />
        </div>
      {:else if id === 'accounts' && items.length}
        <div class="card">
          <h2>By account</h2>
          <HBarChart rows={byAccount(data, items).map((r) => ({ ...r, color: accColor(r.id), sub: `${r.count} operations` }))} format={money} />
        </div>
      {:else if id === 'weekday' && items.length}
        {@const wd = byWeekday(items)}
        <div class="card">
          <h2>Day of the week</h2>
          <BarChart labels={WEEKDAYS} readoutLabels={WEEKDAYS.map((d, i) => `${d}, ${wd.count[i]} operations`)} series={[{ name: 'Total', values: wd.total, color: mainColor }]} format={money} />
          <p class="hint">Uses the purchase date for card payments.</p>
        </div>
      {:else if id === 'sizes' && items.length}
        {@const sz = sizeDistribution(items)}
        <div class="card">
          <h2>Payment sizes</h2>
          <BarChart labels={['<10', '10+', '20+', '50+', '100+', '200+', '500+']} readoutLabels={sz.labels.map((l, i) => `${l}: ${money(sz.total[i])} in total`)} series={[{ name: 'Number of operations', values: sz.count, color: mainColor }]} format={(v) => `${v} operations`} axis={(v) => String(Math.round(v))} />
          <p class="hint">How many operations fall in each amount range, in euros.</p>
        </div>
      {:else if id === 'pace' && items.length}
        {@const pace = monthPace(items, paceMonth, span)}
        <div class="card">
          <h2>Spending pace</h2>
          <select aria-label="Month for the pace chart" value={paceMonth} onchange={(e) => (st.paceMonth = (e.target as HTMLSelectElement).value)} style="margin-bottom: 10px">
            {#each [...span].reverse() as m}<option value={m}>{formatMonth(m)}</option>{/each}
          </select>
          <LineChart
            labels={pace.days.map(String)}
            readoutLabels={pace.days.map((d) => `Day ${d}`)}
            series={[
              { name: formatMonth(paceMonth), values: pace.current, color: mainColor },
              { name: 'Average of the other months', values: pace.average, color: 'var(--muted)', dashed: true },
            ]}
            format={money}
          />
          <p class="hint">Running total through the month compared with your usual month.</p>
        </div>
      {:else if id === 'balances'}
        {@const accs = data.accounts.filter((a) => data.balances.some((b) => b.accountId === a.id) && (!st.accountIds.length || st.accountIds.includes(a.id)))}
        <div class="card">
          <h2>Account balances</h2>
          {#if accs.length}
            <LineChart
              labels={monthLabels}
              readoutLabels={monthLong.map((m) => 'End of ' + m)}
              series={accs.map((a) => ({ name: a.name, values: balanceHistory(data, a.id, span), color: `var(--acc-${a.color ?? 1})` }))}
              format={money}
              zeroBased={false}
            />
            <p class="hint">Month end balances, rebuilt from the balance in your bank files. Only the account filter applies here.</p>
          {:else}
            <p class="muted">No bank balance known yet. Balances come from the bank files.</p>
          {/if}
        </div>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .flabel { font-size: 0.85rem; font-weight: 650; margin: 10px 0 6px; }
  .chips.wrap { flex-wrap: wrap; overflow: visible; }
</style>
