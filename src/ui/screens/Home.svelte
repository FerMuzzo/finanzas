<script lang="ts">
  import { app, go, lock, mirror, resumeMirror, showOperations } from '../app.svelte';
  import { formatDay, formatMonth, todayIso } from '../../core/dates';
  import { formatCents } from '../../core/money';
  import { BANK_NAMES } from '../../core/model';
  import { latestBalance, monthlySummaries, spendingByCategory } from '../../core/summary';
  import { suggestions, seriesStatuses } from '../../core/recurring';
  import Icon from '../Icon.svelte';
  import MonthBars from '../MonthBars.svelte';
  import AccountSheet from '../AccountSheet.svelte';
  import { currentBalance } from '../../core/savings';
  import type { Account } from '../../core/model';

  let openAccount = $state<Account | null>(null);

  const data = $derived(app.data!);
  const months = $derived(monthlySummaries(data));
  const month = $derived(app.selectedMonth && months.some((m) => m.month === app.selectedMonth) ? app.selectedMonth : months[0]?.month ?? '');
  const current = $derived(months.find((m) => m.month === month));
  const topCats = $derived(month ? spendingByCategory(data, [month]).slice(0, 4) : []);
  const catName = (id: string | null) => (id ? data.categories.find((c) => c.id === id)?.name ?? id : 'Not categorized');
  const toReview = $derived(data.transactions.filter((t) => !t.categoryId && !t.transferId).length);
  const sugg = $derived(suggestions(data).length);
  const regularOut = $derived(seriesStatuses(data).filter((s) => s.monthly < 0).reduce((s, x) => s - x.monthly, 0));
  const backupAge = $derived(data.settings.lastBackupAt ? (Date.now() - Date.parse(data.settings.lastBackupAt)) / 86400000 : Infinity);
  const isCurrent = $derived(month === todayIso().slice(0, 7));
</script>

<div class="page">
  <div class="topbar">
    <h1>Overview</h1>
    <div>
      <button class="ghost" onclick={() => go('import')} aria-label="Import a bank file"><Icon name="upload" /></button>
      <button class="ghost" onclick={() => go('settings')} aria-label="Settings"><Icon name="settings" /></button>
      <button class="ghost" onclick={lock} aria-label="Lock"><Icon name="lock" /></button>
    </div>
  </div>

  {#if months.length === 0}
    <div class="card">
      <h2>Start with a bank file</h2>
      <p class="muted">Export the CSV of your Société Générale or Hello bank account and import it here. Each month is detected automatically. You can also add an expense by hand with the + button.</p>
      <button class="block" onclick={() => go('import')}>Import a bank file</button>
    </div>
  {:else}
    {#if mirror.status === 'needs-permission' || mirror.status === 'error'}
      <div class="notice warn row">
        <span>The encrypted copy in {mirror.name} is paused.</span>
        <button class="small secondary" onclick={resumeMirror}>Resume</button>
      </div>
    {/if}
    {#if !app.demo && backupAge > 30 && mirror.status !== 'ok'}
      <div class="notice warn row">
        <span>{data.settings.lastBackupAt ? 'Last backup over a month ago.' : 'No backup yet.'} Your data only lives on this phone.</span>
        <button class="small secondary" onclick={() => go('settings')}>Back up</button>
      </div>
    {/if}

    <div class="card">
      <div class="row" style="margin-bottom: 10px">
        <h2 style="margin: 0">{formatMonth(month)}{isCurrent ? ' so far' : ''}</h2>
        <button class="small ghost" onclick={() => showOperations({ month })}>Operations</button>
      </div>
      <div class="grid3">
        <div class="stat"><div class="label">Income</div><div class="value num in">{formatCents(current?.income ?? 0)}</div></div>
        <div class="stat"><div class="label">Spending</div><div class="value num">{formatCents(current?.spending ?? 0)}</div></div>
        <div class="stat"><div class="label">Left over</div><div class="value num" class:bad={(current?.net ?? 0) < 0} class:in={(current?.net ?? 0) > 0}>{formatCents(current?.net ?? 0, 'EUR', { sign: true })}</div></div>
      </div>
      {#if current && current.savings}
        <p class="hint" style="margin: 8px 0 0">Moved to savings: {formatCents(current.savings)}</p>
      {/if}
      <div style="margin-top: 14px">
        <MonthBars {months} selected={month} onselect={(m) => (app.selectedMonth = m)} />
      </div>
      <p class="hint" style="margin: 8px 0 0">Transfers between your own accounts are left out.</p>
    </div>

    {#if toReview > 0 || sugg > 0}
      <div class="card">
        <h2>To do</h2>
        {#if sugg > 0}
          <button class="catrow" onclick={() => go('regular')}>
            <div class="top"><span class="name">Confirm {sugg} regular payment{sugg > 1 ? 's' : ''}</span><span class="badge accent">{sugg}</span></div>
            <span class="delta">Rent, bills and subscriptions found in your operations</span>
          </button>
        {/if}
        {#if toReview > 0}
          <button class="catrow" onclick={() => showOperations({ categoryId: '__none' })}>
            <div class="top"><span class="name">Categorize {toReview} operation{toReview > 1 ? 's' : ''}</span><span class="badge warn">{toReview}</span></div>
            <span class="delta">Each choice also teaches the app that merchant</span>
          </button>
        {/if}
      </div>
    {/if}

    <div class="card">
      <div class="row"><h2 style="margin: 0">Top spending</h2><button class="small ghost" onclick={() => go('spending')}>All categories</button></div>
      <ul class="list" style="margin-top: 6px">
        {#each topCats as c}
          <li class="row" style="padding: 9px 0">
            <span class:muted={!c.categoryId}>{catName(c.categoryId)}</span>
            <span class="num">{formatCents(c.amount)}</span>
          </li>
        {/each}
      </ul>
      {#if regularOut > 0}
        <p class="hint" style="margin: 8px 0 0">Regular payments you follow: {formatCents(regularOut)} per month.</p>
      {/if}
    </div>

    <div class="card">
      <h2>Accounts</h2>
      <p class="hint" style="margin-top: -4px">Tap an account to set it as savings and simulate the interest.</p>
      <ul class="list">
        {#each data.accounts as a (a.id)}
          {@const bal = latestBalance(data, a.id)}
          {@const now = currentBalance(data, a)}
          <li>
            <button class="tx" onclick={() => (openAccount = a)}>
              <span class="accbar" style="background: var(--acc-{a.color ?? 1})"></span>
              <div class="main">
                <div class="name">{a.name}</div>
                <div class="sub">{a.type === 'savings' ? 'Savings' + (a.interestRate ? ' · ' + String(a.interestRate).replace('.', ',') + '%' : '') : BANK_NAMES[a.bank]}{bal ? ' · bank balance on ' + formatDay(bal.date) : ''}</div>
              </div>
              <span class="num amt">{now !== null ? formatCents(now) : 'not known'}</span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

{#if openAccount}<AccountSheet account={openAccount} onclose={() => (openAccount = null)} />{/if}
