<script lang="ts">
  import { app, showOperations } from './app.svelte';
  import { formatDay, formatMonth, formatShortMonth } from '../core/dates';
  import { formatCents } from '../core/money';
  import type { Transaction } from '../core/model';
  import { DEFAULT_SIMILAR, findSimilarOperations, monthlySeries, similarStats, type SimilarOptions } from '../core/similar';
  import BarChart from './charts/BarChart.svelte';
  import LineChart from './charts/LineChart.svelte';
  import RecordElsewhere from './RecordElsewhere.svelte';

  let { tx, onback, onclose }: { tx: Transaction; onback: () => void; onclose?: () => void } = $props();

  function selectInOperations() {
    const ids = list.map((t) => t.id);
    showOperations({ ids, idsLabel: `Similar to ${tx.counterparty}` }, { select: ids });
    onclose?.();
  }

  const data = $derived(app.data!);
  let opts = $state<SimilarOptions>({ ...DEFAULT_SIMILAR });
  let view = $state<'month' | 'each'>('month');
  const list = $derived(findSimilarOperations(data, tx, opts));
  const stats = $derived(similarStats(list));
  const series = $derived(monthlySeries(list));
  const chrono = $derived([...list].sort((a, b) => (a.opDate ?? a.date).localeCompare(b.opDate ?? b.date)));
  const acc = (id: string) => data.accounts.find((a) => a.id === id);
  const color = $derived(tx.amount < 0 ? 'var(--c-spend)' : 'var(--c-income)');
  const pos = (v: number) => formatCents(Math.abs(v));
  let recording = $state(false);
  const unlinked = $derived(list.filter((t) => !t.transferId));
  const sameDirection = $derived(unlinked.filter((t) => Math.sign(t.amount) === Math.sign(tx.amount)));
</script>

{#if recording}
  <RecordElsewhere txs={sameDirection} onback={() => (recording = false)} ondone={() => (recording = false)} />
{:else}

<div class="row" style="margin-bottom: 10px">
  <button class="small ghost" style="padding-left: 0" onclick={onback}>‹ Back to the operation</button>
</div>
<h2 style="margin-bottom: 2px">Similar to {tx.counterparty}</h2>
<p class="hint" style="margin-top: 0">{formatCents(tx.amount, tx.currency, { sign: true })} on {formatDay(tx.opDate ?? tx.date)}</p>

<div class="card flat">
  <label style="display: flex; gap: 10px; align-items: center; font-weight: 500">
    <input type="checkbox" bind:checked={opts.byName} style="width: 22px; min-height: 22px" /> Same or similar name
  </label>
  <label style="display: flex; gap: 10px; align-items: center; font-weight: 500; margin-top: 8px">
    <input type="checkbox" bind:checked={opts.byAmount} style="width: 22px; min-height: 22px" /> Similar amount
  </label>
  {#if opts.byAmount}
    <div class="chips" style="margin-top: 8px">
      {#each [0.05, 0.15, 0.3] as tol}
        <button class="chip" class:on={opts.amountTolerance === tol} onclick={() => (opts.amountTolerance = tol)}>within {Math.round(tol * 100)}%</button>
      {/each}
    </div>
  {/if}
</div>

{#if stats}
  <div class="grid3" style="margin-bottom: 12px">
    <div class="stat"><div class="label">Operations</div><div class="value num">{stats.count}</div></div>
    <div class="stat"><div class="label">Total</div><div class="value num">{pos(stats.total)}</div></div>
    <div class="stat"><div class="label">Per month</div><div class="value num">{pos(stats.perMonth)}</div></div>
  </div>
  <p class="hint">Average {pos(stats.average)} each time, from {pos(stats.min)} to {pos(stats.max)}, between {formatDay(stats.first)} and {formatDay(stats.last)}.</p>

  {#if list.length > 1}
    <div class="card flat">
      <div class="seg" role="tablist">
        <button class:on={view === 'month'} role="tab" aria-selected={view === 'month'} onclick={() => (view = 'month')}>Per month</button>
        <button class:on={view === 'each'} role="tab" aria-selected={view === 'each'} onclick={() => (view = 'each')}>Each payment</button>
      </div>
      {#if view === 'month'}
        <BarChart labels={series.months.map((m) => formatShortMonth(m))} readoutLabels={series.months.map((m) => formatMonth(m))} series={[{ name: tx.counterparty, values: series.values, color }]} format={(v) => formatCents(v)} />
      {:else}
        <LineChart
          labels={chrono.map((t) => (t.opDate ?? t.date).slice(8, 10) + '.' + (t.opDate ?? t.date).slice(5, 7))}
          readoutLabels={chrono.map((t) => formatDay(t.opDate ?? t.date) + ', ' + t.counterparty)}
          series={[{ name: 'Amount', values: chrono.map((t) => Math.abs(t.amount)), color }]}
          format={(v) => formatCents(v)}
        />
      {/if}
    </div>
  {/if}

  <div class="card" style="padding: 0 14px">
    <ul class="list">
      {#each list as t (t.id)}
        <li class="tx" style="padding: 9px 0" class:current={t.id === tx.id}>
          <span class="accbar" style="background: var(--acc-{acc(t.accountId)?.color ?? 1})"></span>
          <div class="main">
            <div class="name">{t.counterparty}{t.id === tx.id ? ' (this one)' : ''}</div>
            <div class="sub">{formatDay(t.opDate ?? t.date)} · {acc(t.accountId)?.name}</div>
          </div>
          <div class="amt num" class:in={t.amount > 0}>{formatCents(t.amount, t.currency, { sign: true })}</div>
        </li>
      {/each}
    </ul>
  </div>

  {#if list.length > 1}
    <button class="block" style="margin-bottom: 8px" onclick={selectInOperations} data-testid="similar-select">Categorize these {list.length} together</button>
  {/if}
  {#if sameDirection.length > 1 && data.accounts.length > 1}
    <button class="block secondary" onclick={() => (recording = true)}>Record these {sameDirection.length} in another of my accounts</button>
    <p class="hint">For example the monthly transfers to a savings account that has no export.</p>
  {/if}
{/if}
{/if}

<style>
  .current .name { color: var(--accent); }
</style>
