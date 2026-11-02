<script lang="ts">
  import { formatShortMonth } from '../core/dates';
  import { formatCents } from '../core/money';
  import type { MonthSummary } from '../core/summary';

  let { months, selected, onselect }: { months: MonthSummary[]; selected: string; onselect: (m: string) => void } = $props();

  const shown = $derived([...months].slice(0, 6).reverse());
  const max = $derived(Math.max(1, ...shown.map((m) => Math.max(m.income, m.spending))));
</script>

<div class="bars" role="group" aria-label="Income and spending, last months">
  {#each shown as m (m.month)}
    <button class="col" class:on={m.month === selected} onclick={() => onselect(m.month)} aria-label="{formatShortMonth(m.month)}: income {formatCents(m.income)}, spending {formatCents(m.spending)}">
      <div class="pair">
        <div class="bar income" style="height: {(m.income / max) * 100}%"></div>
        <div class="bar spending" style="height: {(m.spending / max) * 100}%"></div>
      </div>
      <span>{formatShortMonth(m.month)}</span>
    </button>
  {/each}
</div>
<div class="legend"><span><i class="income"></i>Income</span><span><i class="spending"></i>Spending</span></div>

<style>
  .bars { display: flex; gap: 6px; align-items: stretch; height: 132px; }
  .col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; background: none; color: var(--muted); padding: 4px 0 0; border-radius: 10px; min-height: 0; font-size: 0.75rem; font-weight: 600; }
  .col.on { background: var(--surface-2); color: var(--text); }
  .pair { flex: 1; width: 100%; display: flex; justify-content: center; align-items: flex-end; gap: 3px; }
  .bar { width: 34%; max-width: 14px; border-radius: 4px 4px 0 0; min-height: 2px; }
  .income { background: var(--c-income); }
  .spending { background: var(--c-spend); }
  .legend { display: flex; gap: 14px; font-size: 0.78rem; color: var(--muted); margin-top: 6px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
</style>
