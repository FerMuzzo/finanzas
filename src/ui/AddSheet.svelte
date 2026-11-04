<script lang="ts">
  import CategorySelect from './CategorySelect.svelte';
  import { app, persist, toast } from './app.svelte';
  import { formatDay, todayIso } from '../core/dates';
  import { formatCents, parseAmount } from '../core/money';
  import { suggestCategory } from '../core/categorize';
  import { keyOf } from '../core/merchant';
  import { addManual, ensureCashAccount, findSimilar } from '../core/manual';
  import type { Transaction } from '../core/model';

  let { onclose }: { onclose: () => void } = $props();

  const data = $derived(app.data!);
  const CASH_NEW = '__cash';
  const hasCash = $derived(data.accounts.some((a) => a.bank === 'cash'));

  let kind = $state<'expense' | 'income'>('expense');
  let amountText = $state('');
  let description = $state('');
  let categoryId = $state('');
  let categoryTouched = $state(false);
  let date = $state(todayIso());
  let accountId = $state(
    app.data!.settings.lastManualAccountId && app.data!.accounts.some((a) => a.id === app.data!.settings.lastManualAccountId)
      ? app.data!.settings.lastManualAccountId
      : app.data!.accounts.find((a) => a.bank === 'cash')?.id ?? app.data!.accounts[0]?.id ?? CASH_NEW,
  );
  let note = $state('');
  let error = $state('');
  let similar = $state<Transaction[] | null>(null);

  const cents = $derived.by(() => {
    const v = parseAmount(amountText);
    return v === null ? null : Math.abs(v);
  });
  const signed = $derived(cents === null ? null : kind === 'expense' ? -cents : cents);
  const known = $derived([...new Set(data.transactions.filter((t) => t.amount < 0 === (kind === 'expense')).map((t) => t.counterparty))].slice(0, 200));

  // Suggest a category from the description, until you pick one yourself
  $effect(() => {
    if (categoryTouched || !description.trim()) return;
    const probe = {
      counterparty: description,
      detail: '',
      label: description,
      merchantKey: keyOf(description),
      amount: kind === 'expense' ? -1 : 1,
      opType: 'manual',
    } as Transaction;
    const s = suggestCategory(probe, data);
    categoryId = s.categoryId ?? '';
  });

  function accName(id: string) {
    return data.accounts.find((a) => a.id === id)?.name ?? '';
  }

  function save(force = false) {
    error = '';
    if (signed === null || signed === 0) {
      error = 'Enter an amount, for example 12,50.';
      return;
    }
    if (!date) {
      error = 'Choose a date.';
      return;
    }
    let acc = accountId;
    if (acc === CASH_NEW) acc = ensureCashAccount(data).id;
    accountId = acc;
    if (!force) {
      const hits = findSimilar(data, { accountId: acc, date, amount: signed });
      if (hits.length) {
        similar = hits.slice(0, 3);
        return;
      }
    }
    addManual(data, { accountId: acc, date, amount: signed, description, categoryId: categoryId || null, note });
    persist();
    toast(`${kind === 'expense' ? 'Expense' : 'Income'} added`);
    onclose();
  }
</script>

<div class="sheet-backdrop" onclick={onclose} role="presentation">
  <div class="sheet" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && onclose()} role="dialog" aria-modal="true" aria-label="Add an operation" tabindex="-1">
    <div class="grip"></div>
    <div class="seg" role="tablist">
      <button class:on={kind === 'expense'} role="tab" aria-selected={kind === 'expense'} onclick={() => (kind = 'expense')}>Expense</button>
      <button class:on={kind === 'income'} role="tab" aria-selected={kind === 'income'} onclick={() => (kind = 'income')}>Income</button>
    </div>

    <form onsubmit={(e) => { e.preventDefault(); save(); }}>
      <div class="field">
        <label for="amt">Amount in euros</label>
        <!-- svelte-ignore a11y_autofocus -->
        <input id="amt" class="amount-input" inputmode="decimal" placeholder="0,00" autocomplete="off" bind:value={amountText} autofocus oninput={() => (similar = null)} />
      </div>
      <div class="field">
        <label for="desc">{kind === 'expense' ? 'Where or what' : 'From'}</label>
        <input id="desc" list="known-names" placeholder={kind === 'expense' ? 'Bakery, market, taxi' : 'Client, person'} bind:value={description} autocomplete="off" />
        <datalist id="known-names">{#each known as n}<option value={n}></option>{/each}</datalist>
      </div>
      <div class="field">
        <label for="cat2">Category</label>
        <CategorySelect
          id="cat2"
          value={categoryId || null}
          kinds={kind === 'expense' ? ['expense', 'savings'] : ['income']}
          onpick={(v) => {
            categoryId = v ?? '';
            categoryTouched = true;
          }}
        />
      </div>
      <div class="row" style="gap: 10px">
        <div class="field" style="flex: 1">
          <label for="dt">Date</label>
          <input id="dt" type="date" bind:value={date} max={todayIso()} oninput={() => (similar = null)} />
        </div>
        <div class="field" style="flex: 1">
          <label for="acc2">Paid with</label>
          <select id="acc2" bind:value={accountId} onchange={() => (similar = null)}>
            {#each data.accounts as a}<option value={a.id}>{a.name}</option>{/each}
            {#if !hasCash}<option value={CASH_NEW}>Cash (new account)</option>{/if}
          </select>
        </div>
      </div>
      {#if accountId === CASH_NEW}
        <p class="hint" style="margin-top: -6px">A Cash account will be created. Cash withdrawals then count as moving money into it, and what you spend in cash is counted when you add it here.</p>
      {/if}
      <div class="field">
        <label for="nt">Note</label>
        <input id="nt" bind:value={note} autocomplete="off" />
      </div>

      {#if error}<div class="notice bad">{error}</div>{/if}

      {#if similar}
        <div class="notice warn" data-testid="similar-warning">
          <strong>This may already be recorded.</strong> In {accName(accountId)}, with the same amount and a close date:
          <ul style="margin: 6px 0 0; padding-left: 18px">
            {#each similar as s}<li>{s.counterparty}, {formatDay(s.opDate ?? s.date)}, {formatCents(s.amount)}</li>{/each}
          </ul>
        </div>
        <div class="row" style="gap: 8px">
          <button type="button" class="block secondary" onclick={onclose}>Don't add</button>
          <button type="button" class="block" onclick={() => save(true)}>Add anyway</button>
        </div>
      {:else}
        <button class="block" type="submit">Add {kind === 'expense' ? 'expense' : 'income'}</button>
        <button class="block ghost" type="button" onclick={onclose}>Cancel</button>
      {/if}
    </form>
    <p class="hint">When the bank file with this payment is imported later, the two are merged automatically, so it is never counted twice.</p>
  </div>
</div>
