<script lang="ts">
  import { untrack } from 'svelte';
  import { app, persist } from './app.svelte';
  import { formatCents, parseAmount } from '../core/money';
  import { BANK_NAMES, type Account } from '../core/model';
  import { averageMonthlyNetFlow, currentBalance, simulateSavings } from '../core/savings';
  import LineChart from './charts/LineChart.svelte';

  let { account, onclose }: { account: Account; onclose: () => void } = $props();

  const data = $derived(app.data!);
  const balance = $derived(currentBalance(data, account));
  const avgFlow = $derived(averageMonthlyNetFlow(data, account.id));

  let rateText = $state(untrack(() => (account.interestRate !== undefined ? String(account.interestRate).replace('.', ',') : '')));
  let startText = $state('');
  let monthlyText = $state('');
  let years = $state(5);

  $effect(() => {
    // Defaults for the simulation: today's balance and what usually goes in each month
    if (!startText && balance !== null) startText = (balance / 100).toFixed(2).replace('.', ',');
    if (!monthlyText) monthlyText = (Math.max(0, avgFlow) / 100).toFixed(0);
  });

  const isSavings = $derived(account.type === 'savings');
  const rate = $derived(Number((rateText || '0').replace(',', '.')) || 0);
  const start = $derived(parseAmount(startText) ?? 0);
  const monthly = $derived(parseAmount(monthlyText) ?? 0);
  const sim = $derived(simulateSavings({ start, monthly, ratePct: rate, years, interestPaid: account.interestPaid ?? 'yearly', taxPct: account.interestTax ?? 0 }));
  const yearIdx = $derived(sim.points.filter((p) => p.month % 12 === 0));
  const nextYear = $derived(simulateSavings({ start, monthly: 0, ratePct: rate, years: 1, interestPaid: account.interestPaid ?? 'yearly', taxPct: account.interestTax ?? 0 }).final.interest);

  function setSavings(e: Event) {
    account.type = (e.target as HTMLInputElement).checked ? 'savings' : account.bank === 'cash' ? 'cash' : 'checking';
    persist();
  }
  function saveRate() {
    const v = Number(rateText.replace(',', '.'));
    account.interestRate = rateText.trim() && Number.isFinite(v) ? v : undefined;
    persist();
  }
  function setPaid(e: Event) {
    account.interestPaid = (e.target as HTMLSelectElement).value as 'yearly' | 'monthly';
    persist();
  }
  function setTax(e: Event) {
    account.interestTax = Number((e.target as HTMLSelectElement).value);
    persist();
  }
</script>

<div class="sheet-backdrop" onclick={onclose} role="presentation">
  <div class="sheet" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && onclose()} role="dialog" aria-modal="true" aria-label="Account" tabindex="-1">
    <div class="grip"></div>
    <div class="row" style="align-items: flex-start">
      <div>
        <h2 style="margin-bottom: 2px"><span class="accdot" style="background: var(--acc-{account.color ?? 1})"></span>{account.name}</h2>
        <small>{BANK_NAMES[account.bank]}{account.last4 ? ' · ending ' + account.last4 : ''}</small>
      </div>
      <div class="num" style="font-size: 1.3rem; font-weight: 700">{balance !== null ? formatCents(balance) : ''}</div>
    </div>

    <div class="card flat" style="margin-top: 12px">
      <label style="display: flex; gap: 10px; align-items: center; font-weight: 600; margin: 0">
        <input type="checkbox" checked={isSavings} onchange={setSavings} style="width: 22px; min-height: 22px" /> This is a savings account
      </label>
      {#if isSavings}
        <div class="row" style="gap: 10px; margin-top: 12px; align-items: flex-end">
          <div class="field" style="flex: 1; margin: 0">
            <label for="rate">Interest rate per year (%)</label>
            <input id="rate" inputmode="decimal" placeholder="for example 2,4" bind:value={rateText} onchange={saveRate} />
          </div>
          <div class="field" style="flex: 1; margin: 0">
            <label for="paid">Interest added</label>
            <select id="paid" value={account.interestPaid ?? 'yearly'} onchange={setPaid}>
              <option value="yearly">Once a year</option>
              <option value="monthly">Every month</option>
            </select>
          </div>
        </div>
        <div class="field" style="margin: 10px 0 0">
          <label for="tax">Tax on interest</label>
          <select id="tax" value={String(account.interestTax ?? 0)} onchange={setTax}>
            <option value="0">None (Livret A, LDDS, LEP)</option>
            <option value="30">30% flat tax (other savings accounts)</option>
          </select>
        </div>
        <p class="hint">Regulated livrets add interest once a year, on 31 December. Enter the rate your bank shows for this account.</p>
      {/if}
    </div>

    {#if isSavings}
      <div class="card flat">
        <h3>Simulate the gain</h3>
        <div class="row" style="gap: 10px">
          <div class="field" style="flex: 1; margin: 0">
            <label for="st">Starting amount (€)</label>
            <input id="st" inputmode="decimal" bind:value={startText} />
          </div>
          <div class="field" style="flex: 1; margin: 0">
            <label for="mo">Added each month (€)</label>
            <input id="mo" inputmode="decimal" bind:value={monthlyText} />
          </div>
        </div>
        {#if avgFlow > 0}<p class="hint">On average {formatCents(avgFlow)} went into this account each month recently.</p>{/if}
        <div class="chips" style="margin: 10px 0">
          {#each [1, 2, 5, 10, 20] as y}
            <button class="chip" class:on={years === y} onclick={() => (years = y)}>{y} {y === 1 ? 'year' : 'years'}</button>
          {/each}
        </div>
        {#if rate <= 0}
          <p class="muted">Enter the interest rate above to see the gain.</p>
        {:else}
          <div class="grid3">
            <div class="stat"><div class="label">After {years} {years === 1 ? 'year' : 'years'}</div><div class="value num">{formatCents(sim.final.balance)}</div></div>
            <div class="stat"><div class="label">You put in</div><div class="value num">{formatCents(sim.final.deposited)}</div></div>
            <div class="stat"><div class="label">Interest</div><div class="value num in">{formatCents(sim.final.interest)}</div></div>
          </div>
          <p class="hint">Over the next 12 months, the current amount alone earns about {formatCents(nextYear)}.</p>
          <div style="margin-top: 10px">
            <LineChart
              labels={yearIdx.map((p) => (p.month === 0 ? 'now' : `${p.month / 12}y`))}
              readoutLabels={yearIdx.map((p) => (p.month === 0 ? 'Today' : `After ${p.month / 12} year${p.month === 12 ? '' : 's'}`))}
              series={[
                { name: 'Balance with interest', values: yearIdx.map((p) => p.balance), color: 'var(--c-income)' },
                { name: 'Money you put in', values: yearIdx.map((p) => p.deposited), color: 'var(--muted)', dashed: true },
              ]}
              format={(v) => formatCents(v)}
            />
          </div>
          <p class="hint">A projection with a constant rate; real rates change over time. This is not financial advice.</p>
        {/if}
      </div>
    {/if}

    <button class="block secondary" style="margin-top: 8px" onclick={onclose}>Close</button>
  </div>
</div>
