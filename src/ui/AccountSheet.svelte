<script lang="ts">
  import { untrack } from 'svelte';
  import { app, confirmIdentity, persist, toast } from './app.svelte';
  import { formatCents, parseAmount } from '../core/money';
  import { formatDay, todayIso } from '../core/dates';
  import { balanceAt, checkpoints, setBalance } from '../core/balances';
  import { cleanNames, findMatches, matchesNames, setTransferNames, staleRecords } from '../core/ownTransfers';
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

  // Correcting the balance: enter it, review the difference, then confirm who you are
  let fixStep = $state<'' | 'form' | 'review'>('');
  let fixText = $state('');
  let fixDate = $state(todayIso());
  let fixPass = $state('');
  let fixError = $state('');
  let fixBusy = $state(false);
  const snaps = $derived(checkpoints(data, account.id).slice(0, 4));
  const fixAmount = $derived(parseAmount(fixText));
  const before = $derived(balanceAt(data, account, fixDate));
  const later = $derived(data.transactions.filter((t) => t.accountId === account.id && t.date > fixDate).reduce((s, t) => s + t.amount, 0));

  function startFix() {
    fixStep = 'form';
    fixText = '';
    fixDate = todayIso();
    fixPass = '';
    fixError = '';
  }
  function review(e: SubmitEvent) {
    e.preventDefault();
    fixError = '';
    if (fixAmount === null) {
      fixError = 'Enter the balance as an amount, for example 3 500,00.';
      return;
    }
    if (!fixDate || fixDate > todayIso()) {
      fixError = 'Choose a day that is not in the future.';
      return;
    }
    fixStep = 'review';
  }
  async function confirmFix(how: 'pass' | 'bio') {
    if (fixAmount === null) return;
    fixBusy = true;
    fixError = '';
    try {
      await confirmIdentity(how === 'bio' ? { bio: true } : { passphrase: fixPass });
      setBalance(data, account, fixDate, fixAmount, how === 'bio' ? 'confirmed with fingerprint' : 'confirmed with passphrase');
      persist();
      toast('Balance updated');
      fixStep = '';
      fixPass = '';
    } catch (err) {
      fixError = (err as Error).message || 'Not confirmed.';
    } finally {
      fixBusy = false;
    }
  }

  // Transfer names: transfers in your other accounts that show them are recorded here
  let namesText = $state(untrack(() => (account.transferNames ?? []).join('\n')));
  const names = $derived(cleanNames(namesText));
  const namesChanged = $derived(names.join('\n') !== (account.transferNames ?? []).join('\n'));
  const namePreview = $derived.by(() => {
    if (!namesChanged) return null;
    const m = findMatches(data, { accountId: account.id, names });
    const record = m.record.filter((c) => c.target.id === account.id).map((c) => c.t);
    const ambiguous = names.length ? m.ambiguous.filter((t) => matchesNames(t, names)) : [];
    const stale = staleRecords(data, account, names);
    const into = record.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);
    const out = record.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    return { record: [...record].sort((x, y) => y.date.localeCompare(x.date)), ambiguous, stale, into, out };
  });
  const autoCount = $derived(data.transactions.filter((t) => t.accountId === account.id && t.autoRecorded).length);
  const accName = (id: string) => data.accounts.find((x) => x.id === id)?.name ?? '';

  function saveNames() {
    const r = setTransferNames(data, account.id, names);
    persist();
    namesText = names.join('\n');
    toast(r.added || r.removed ? `${r.added} recorded here${r.removed ? `, ${r.removed} removed` : ''}` : 'Names saved');
  }

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

    <div class="card flat" style="margin-top: 12px" data-testid="balance-card">
      {#if fixStep === ''}
        <div class="row">
          <h3 style="margin: 0">Balance</h3>
          <span class="num" style="font-weight: 650">{balance !== null ? formatCents(balance) : 'not known yet'}</span>
        </div>
        {#if snaps.length}
          <ul class="list" style="margin-top: 6px">
            {#each snaps as s (s.date + s.source + (s.setAt ?? ''))}
              <li class="row" style="padding: 6px 0; font-size: 0.9rem">
                <span>{formatDay(s.date)} <small class="muted">· {s.source === 'manual' ? 'set by hand' : 'from the bank'}</small></span>
                <span class="num">{formatCents(s.amount)}</span>
              </li>
            {/each}
          </ul>
          <p class="hint">The balance counts from the latest of these, plus the operations dated after it.</p>
        {:else}
          <p class="hint">No balance known for this account yet. Import a statement, which carries the balance, or set it here.</p>
        {/if}
        <button class="block secondary" style="margin-top: 8px" onclick={startFix}>{balance === null ? 'Set the balance' : 'Correct the balance'}</button>
      {:else if fixStep === 'form'}
        <h3 style="margin-top: 0">{balance === null ? 'Set the balance' : 'Correct the balance'}</h3>
        <form onsubmit={review}>
          <div class="row" style="gap: 10px; align-items: flex-end">
            <div class="field" style="flex: 1">
              <label for="fix-amt">Balance (€)</label>
              <input id="fix-amt" inputmode="decimal" bind:value={fixText} placeholder="as shown by the bank" autocomplete="off" />
            </div>
            <div class="field" style="flex: 1">
              <label for="fix-date">At the end of</label>
              <input id="fix-date" type="date" bind:value={fixDate} max={todayIso()} />
            </div>
          </div>
          {#if fixError}<div class="notice bad">{fixError}</div>{/if}
          <div class="row" style="gap: 8px">
            <button type="button" class="block secondary" onclick={() => (fixStep = '')}>Cancel</button>
            <button type="submit" class="block">Review</button>
          </div>
        </form>
      {:else}
        <h3 style="margin-top: 0">Check before saving</h3>
        <dl class="kv" data-testid="fix-review">
          <dt>On {formatDay(fixDate)}, the app counts</dt><dd class="num">{before !== null ? formatCents(before) : 'not known'}</dd>
          <dt>New balance</dt><dd class="num"><strong>{formatCents(fixAmount ?? 0)}</strong></dd>
          {#if before !== null}<dt>Difference</dt><dd class="num" class:in={(fixAmount ?? 0) - before > 0}>{formatCents((fixAmount ?? 0) - before, 'EUR', { sign: true })}</dd>{/if}
          <dt>Balance today becomes</dt><dd class="num">{formatCents((fixAmount ?? 0) + later)}</dd>
        </dl>
        <p class="hint">Operations are not changed. From now on the balance counts from this amount, plus the operations dated after {formatDay(fixDate)}. The change is written in the history.</p>
        <div class="field" style="margin: 12px 0 8px">
          <label for="fix-pass">Your passphrase, to confirm</label>
          <input id="fix-pass" type="password" bind:value={fixPass} autocomplete="current-password" />
        </div>
        {#if fixError}<div class="notice bad">{fixError}</div>{/if}
        <button class="block" disabled={fixBusy || !fixPass} onclick={() => confirmFix('pass')}>Confirm with passphrase</button>
        {#if app.bioOn}<button class="block secondary" style="margin-top: 8px" disabled={fixBusy} onclick={() => confirmFix('bio')}>Confirm with fingerprint</button>{/if}
        <button class="block ghost" style="margin-top: 8px" onclick={() => (fixStep = 'form')}>Back</button>
      {/if}
    </div>

    <div class="card flat" data-testid="transfer-names">
      <h3 style="margin-top: 0">Transfers to and from this account</h3>
      <p class="hint" style="margin-top: 0">If this account is only reached from another of your accounts, write the name the bank shows on those transfers, one per line: the beneficiary name, or a word of the reason. Every matching transfer in your other accounts is then added here automatically, now and at each import, so the balance stays up to date.</p>
      <label for="tn" class="sr-only">Names shown on transfers to and from {account.name}</label>
      <textarea id="tn" rows="2" bind:value={namesText} placeholder="for example M. Firstname Lastname" autocomplete="off"></textarea>
      {#if namePreview}
        <div class="preview" data-testid="names-preview">
          {#if namePreview.record.length}
            <p style="margin: 8px 0 4px">
              <strong>{namePreview.record.length} operation{namePreview.record.length === 1 ? '' : 's'}</strong> of your other accounts match{namePreview.record.length === 1 ? 'es' : ''}:
              {#if namePreview.into}<span class="in num">+{formatCents(namePreview.into)}</span> into this account{/if}{#if namePreview.into && namePreview.out}{', '}{/if}{#if namePreview.out}<span class="num">{formatCents(namePreview.out)}</span> taken out{/if}.
            </p>
            <ul class="list">
              {#each namePreview.record.slice(0, 5) as t (t.id)}
                <li class="row" style="padding: 6px 0; font-size: 0.88rem">
                  <span>{formatDay(t.date)} <small class="muted">· {t.counterparty} · {accName(t.accountId)}</small></span>
                  <span class="num" class:in={t.amount < 0}>{formatCents(-t.amount, t.currency, { sign: true })}</span>
                </li>
              {/each}
            </ul>
            {#if namePreview.record.length > 5}<p class="hint" style="margin: 0">and {namePreview.record.length - 5} more</p>{/if}
          {:else if names.length}
            <p class="muted" style="margin: 8px 0 0">No operation in your other accounts matches yet. New imports will be checked.</p>
          {/if}
          {#if namePreview.ambiguous.length}
            <div class="notice warn" style="margin: 8px 0 0">{namePreview.ambiguous.length} also match{namePreview.ambiguous.length === 1 ? 'es' : ''} the names of another of your accounts and {namePreview.ambiguous.length === 1 ? 'is' : 'are'} left alone. Add a word that only appears for this account, or record {namePreview.ambiguous.length === 1 ? 'it' : 'them'} from the operation.</div>
          {/if}
          {#if namePreview.stale.length}
            <div class="notice warn" style="margin: 8px 0 0">{namePreview.stale.length} operation{namePreview.stale.length === 1 ? '' : 's'} recorded here earlier no longer match{namePreview.stale.length === 1 ? 'es' : ''} and will be removed.</div>
          {/if}
          <div class="row" style="gap: 8px; margin-top: 10px">
            <button class="block secondary" onclick={() => (namesText = (account.transferNames ?? []).join('\n'))}>Cancel</button>
            <button class="block" onclick={saveNames}>Save</button>
          </div>
        </div>
      {:else if account.transferNames?.length}
        <p class="hint">{autoCount} operation{autoCount === 1 ? '' : 's'} recorded here automatically so far.</p>
      {/if}
    </div>

    <div class="card flat">
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

<style>
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
