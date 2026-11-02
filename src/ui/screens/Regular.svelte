<script lang="ts">
  import { app, persist, toast } from '../app.svelte';
  import { formatDay } from '../../core/dates';
  import { formatCents } from '../../core/money';
  import { CADENCE_LABELS, type RecurringSeries } from '../../core/model';
  import { confirmSeries, dismissSeries, forgetSeries, seriesStatuses, suggestions, type RecurringCandidate } from '../../core/recurring';

  const data = $derived(app.data!);
  const sugg = $derived(suggestions(data));
  const statuses = $derived(seriesStatuses(data));
  const outflows = $derived(statuses.filter((s) => s.monthly < 0));
  const inflows = $derived(statuses.filter((s) => s.monthly > 0));
  const monthlyOut = $derived(outflows.reduce((s, x) => s + -x.monthly, 0));
  const monthlyIn = $derived(inflows.reduce((s, x) => s + x.monthly, 0));
  const subsYear = $derived(outflows.filter((s) => s.series.categoryId === 'subscriptions').reduce((s, x) => s + -x.monthly * 12, 0));
  const dismissed = $derived(data.recurring.filter((r) => r.status === 'dismissed'));
  let showDismissed = $state(false);
  let selected = $state<string | null>(null);

  const catName = (id: string | null) => (id ? data.categories.find((c) => c.id === id)?.name ?? '' : 'Not categorized');

  function when(c: RecurringCandidate): string {
    const base = CADENCE_LABELS[c.cadence];
    return c.dayOfMonth ? `${base}, around the ${ordinal(c.dayOfMonth)}` : base;
  }
  function ordinal(n: number): string {
    const s = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
    return n + s;
  }
  function amountText(c: RecurringCandidate): string {
    const sign = c.typical > 0 ? '+' : '';
    if (c.fixed || c.min === c.max) return sign + formatCents(Math.abs(c.typical));
    const lo = Math.min(Math.abs(c.min), Math.abs(c.max));
    const hi = Math.max(Math.abs(c.min), Math.abs(c.max));
    return `${sign}${formatCents(lo)} to ${formatCents(hi)}`;
  }

  function yes(c: RecurringCandidate) {
    confirmSeries(data, c);
    persist();
  }
  function no(c: RecurringCandidate) {
    dismissSeries(data, c);
    persist();
  }
  function confirmAll() {
    const n = sugg.length;
    for (const c of sugg) confirmSeries(data, c);
    persist();
    toast(`${n} regular payments saved`);
  }
  function forget(s: RecurringSeries) {
    forgetSeries(data, s.id);
    selected = null;
    persist();
  }
</script>

<div class="page">
  <div class="topbar"><h1>Regular payments</h1></div>

  <div class="card">
    <div class="grid3" style="grid-template-columns: 1fr 1fr">
      <div class="stat"><div class="label">Regular spending per month</div><div class="value num">{formatCents(monthlyOut)}</div></div>
      <div class="stat"><div class="label">Regular income per month</div><div class="value num in">{formatCents(monthlyIn)}</div></div>
    </div>
    {#if subsYear > 0}
      <p class="hint" style="margin: 10px 0 0">Subscriptions cost you {formatCents(subsYear)} per year.</p>
    {/if}
  </div>

  {#if sugg.length}
    <div class="row" style="margin: 18px 2px 8px">
      <h2 style="margin: 0">To confirm ({sugg.length})</h2>
      {#if sugg.length > 1}<button class="small secondary" onclick={confirmAll}>Confirm all</button>{/if}
    </div>
    <p class="hint" style="margin: 0 2px 10px">These come back regularly with a similar amount. Is each one a regular payment you want to follow every month?</p>
    {#each sugg as c (c.key)}
      <div class="card">
        <div class="row" style="align-items: flex-start">
          <div>
            <div style="font-weight: 650">{c.name}</div>
            <small>{catName(c.categoryId)} · seen {c.count} times, last on {formatDay(c.lastDate)}</small>
          </div>
          <div class="num" style="font-weight: 650; text-align: right" class:in={c.typical > 0}>{amountText(c)}</div>
        </div>
        <p class="muted" style="margin: 6px 0 10px; font-size: 0.9rem">{when(c)}. Next expected {formatDay(c.nextDate)}.</p>
        <div class="row" style="gap: 8px">
          <button class="block secondary" onclick={() => no(c)}>Not regular</button>
          <button class="block" onclick={() => yes(c)}>Yes, follow it</button>
        </div>
      </div>
    {/each}
  {:else if statuses.length === 0}
    <div class="card"><p class="muted" style="margin: 0">No regular payments found yet. They appear after two or three months of operations.</p></div>
  {/if}

  {#if statuses.length}
    <h2 style="margin: 18px 2px 8px">Followed ({statuses.length})</h2>
    <div class="card" style="padding: 0 14px">
      <ul class="list">
        {#each statuses as st (st.series.id)}
          <li>
            <button class="tx" onclick={() => (selected = selected === st.series.id ? null : st.series.id)}>
              <div class="main">
                <div class="name">{st.series.name}</div>
                <div class="sub">{CADENCE_LABELS[st.series.cadence]}{st.nextDate ? ' · next ' + formatDay(st.nextDate) : ''}</div>
                {#if st.priceChange}<span class="badge warn">Price changed: {formatCents(Math.abs(st.priceChange.from))} to {formatCents(Math.abs(st.priceChange.to))}</span>{/if}
                {#if st.late}<span class="badge warn">Not seen since {formatDay(st.lastDate!)}</span>{/if}
              </div>
              <div style="text-align: right">
                <div class="amt num" class:in={st.monthly > 0}>{formatCents(Math.abs(st.monthly))}</div>
                <small>per month</small>
              </div>
            </button>
            {#if selected === st.series.id}
              <div class="sub-list" style="margin-bottom: 10px">
                <div class="row"><span>Category</span><span>{catName(st.series.categoryId)}</span></div>
                <div class="row"><span>Payments found</span><span>{st.count}</span></div>
                {#if st.lastDate}<div class="row"><span>Last</span><span class="num">{formatCents(st.lastAmount ?? 0)} on {formatDay(st.lastDate)}</span></div>{/if}
                <div class="row"><span>Per year</span><span class="num">{formatCents(Math.abs(st.monthly) * 12)}</span></div>
                <button class="small ghost" style="padding-left: 0" onclick={() => forget(st.series)}>Stop following</button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if dismissed.length}
    <button class="ghost" onclick={() => (showDismissed = !showDismissed)}>{showDismissed ? 'Hide' : 'Show'} the {dismissed.length} marked as not regular</button>
    {#if showDismissed}
      <div class="card" style="padding: 4px 14px">
        <ul class="list">
          {#each dismissed as r (r.id)}
            <li class="row" style="padding: 8px 0">
              <span>{r.name}</span>
              <button class="small ghost" onclick={() => forget(r)}>Ask again</button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {/if}
</div>
