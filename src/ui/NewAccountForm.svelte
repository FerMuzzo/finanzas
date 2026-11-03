<script lang="ts">
  import { untrack } from 'svelte';
  import { app, persist, toast } from './app.svelte';
  import { addAccount } from '../core/accounts';
  import { todayIso } from '../core/dates';
  import { parseAmount } from '../core/money';
  import { nextAccountColor, type Account, type BankId } from '../core/model';
  import AccountColor from './AccountColor.svelte';

  let {
    onsave,
    oncancel,
    savings = true,
    withBalance = true,
  }: { onsave: (a: Account) => void; oncancel: () => void; savings?: boolean; withBalance?: boolean } = $props();

  let name = $state('');
  let bank = $state<BankId>('other');
  let isSavings = $state(untrack(() => savings));
  let color = $state(nextAccountColor(app.data!.accounts));
  let balanceText = $state('');
  let balanceDate = $state(todayIso());
  let error = $state('');

  function save(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    const balance = balanceText.trim() ? parseAmount(balanceText) : undefined;
    if (balance === null) {
      error = 'The balance is not a valid amount.';
      return;
    }
    try {
      const a = addAccount(app.data!, { name, bank, type: isSavings ? 'savings' : 'checking', color, balance, balanceDate: balance !== undefined ? balanceDate : undefined });
      persist();
      toast(`${a.name} added`);
      onsave(a);
    } catch (err) {
      error = (err as Error).message;
    }
  }
</script>

<form onsubmit={save} data-testid="new-account">
  <div class="field">
    <label for="na-name">Account name</label>
    <input id="na-name" bind:value={name} placeholder="for example Livret A" autocomplete="off" />
  </div>
  <div class="field">
    <label for="na-bank">Bank</label>
    <select id="na-bank" bind:value={bank}>
      <option value="sg">Société Générale</option>
      <option value="hellobank">Hello bank</option>
      <option value="other">Other bank</option>
    </select>
  </div>
  <label style="display: flex; gap: 10px; align-items: center; font-weight: 500; margin: 0 0 14px">
    <input type="checkbox" bind:checked={isSavings} style="width: 22px; min-height: 22px" /> This is a savings account
  </label>
  {#if withBalance}
    <div class="row" style="gap: 10px; align-items: flex-end">
      <div class="field" style="flex: 1">
        <label for="na-bal">Balance (€), optional</label>
        <input id="na-bal" inputmode="decimal" bind:value={balanceText} placeholder="for example 3 500,00" />
      </div>
      <div class="field" style="flex: 1">
        <label for="na-date">On</label>
        <input id="na-date" type="date" bind:value={balanceDate} max={todayIso()} />
      </div>
    </div>
    <p class="hint" style="margin: -6px 0 12px">Operations dated after this day are added to it. You can also set it later, or import the PDF statements, which carry the balance.</p>
  {/if}
  <p style="font-weight: 600; font-size: 0.9rem; margin-bottom: 6px">Color in the operations list</p>
  <AccountColor bind:value={color} label="Account color" />
  {#if error}<div class="notice bad" style="margin-top: 10px">{error}</div>{/if}
  <div class="row" style="gap: 8px; margin-top: 14px">
    <button type="button" class="block secondary" onclick={oncancel}>Cancel</button>
    <button type="submit" class="block" disabled={!name.trim()}>Add the account</button>
  </div>
</form>
