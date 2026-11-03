<script lang="ts">
  import { app, persist, toast } from './app.svelte';
  import { recordManyInAccount } from '../core/accounts';
  import { formatDay } from '../core/dates';
  import { formatCents } from '../core/money';
  import type { Account, Transaction } from '../core/model';
  import NewAccountForm from './NewAccountForm.svelte';

  let { txs, onback, ondone }: { txs: Transaction[]; onback: () => void; ondone: () => void } = $props();

  const data = $derived(app.data!);
  const todo = $derived(txs.filter((t) => !t.transferId));
  const sourceIds = $derived(new Set(todo.map((t) => t.accountId)));
  const targets = $derived(data.accounts.filter((a) => !sourceIds.has(a.id)));
  const total = $derived(todo.reduce((s, t) => s + t.amount, 0));
  const outgoing = $derived(total < 0);
  let chosen = $state<Account | null>(null);
  let creating = $state(false);
  const name = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? '';
  const sources = $derived([...sourceIds].map(name).join(', '));

  function record() {
    if (!chosen) return;
    const n = recordManyInAccount(data, todo.map((t) => t.id), chosen.id);
    persist();
    toast(`${n} operation${n === 1 ? '' : 's'} recorded in ${chosen.name}`);
    ondone();
  }
</script>

<div class="row" style="margin-bottom: 10px">
  <button class="small ghost" style="padding-left: 0" onclick={onback}>‹ Back</button>
</div>
<h2 style="margin-bottom: 4px">Record in another of my accounts</h2>

{#if !todo.length}
  <p class="muted">{txs.length === 1 ? 'This operation is' : 'These operations are'} already linked to the other side of the transfer.</p>
{:else if creating}
  <div class="card flat">
    <h3 style="margin-top: 0">New account</h3>
    <NewAccountForm
      oncancel={() => (creating = false)}
      onsave={(a) => {
        creating = false;
        chosen = data.accounts.find((x) => x.id === a.id) ?? a;
      }}
    />
  </div>
{:else if !chosen}
  <p class="muted" style="margin-top: 0">
    {todo.length === 1 ? 'This operation' : `These ${todo.length} operations`} moved money {outgoing ? 'from' : 'to'} {sources}. Choose the account {outgoing ? 'it went to' : 'it came from'}: the other side is added there, and both are counted as a transfer between your accounts, not as spending or income.
  </p>
  <ul class="list card" style="padding: 0 14px" data-testid="record-targets">
    {#each targets as a (a.id)}
      <li>
        <button class="tx" onclick={() => (chosen = a)}>
          <span class="accbar" style="background: var(--acc-{a.color ?? 1})"></span>
          <div class="main"><div class="name">{a.name}</div><div class="sub">{a.type === 'savings' ? 'Savings account' : 'Account'}</div></div>
        </button>
      </li>
    {/each}
  </ul>
  <button class="block secondary" onclick={() => (creating = true)}>A new account</button>
{:else}
  <div class="card flat">
    <p style="margin-top: 0">
      {#if todo.length === 1}
        <strong>{formatCents(-total, 'EUR', { sign: true })}</strong> will be added to <strong>{chosen.name}</strong> on {formatDay(todo[0].date)}.
      {:else}
        <strong>{todo.length} operations</strong> will be added to <strong>{chosen.name}</strong>, each with the opposite amount, {formatCents(-total, 'EUR', { sign: true })} in total.
      {/if}
    </p>
    {#if todo.length > 1}<ul class="small-list">
      {#each todo.slice(0, 5) as t (t.id)}
        <li>{formatDay(t.date)}: {formatCents(-t.amount, t.currency, { sign: true })}</li>
      {/each}
      {#if todo.length > 5}<li>and {todo.length - 5} more</li>{/if}
    </ul>{/if}
    <p class="hint">{todo.length === 1 ? 'It is' : 'They are'} marked as added by hand. When you later import a statement of {chosen.name}, its bank lines are merged with {todo.length === 1 ? 'it' : 'them'}, so nothing is counted twice.</p>
  </div>
  <div class="row" style="gap: 8px">
    <button class="block secondary" onclick={() => (chosen = null)}>Change account</button>
    <button class="block" onclick={record} data-testid="record-confirm">Record</button>
  </div>
{/if}

<style>
  .small-list { margin: 6px 0; padding-left: 18px; font-size: 0.92rem; }
</style>
