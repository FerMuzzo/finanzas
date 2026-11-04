<script lang="ts">
  import { app } from './app.svelte';
  import { formatDay } from '../core/dates';
  import { formatCents } from '../core/money';
  import type { Transaction } from '../core/model';
  import { DEFAULT_SIMILAR, findSimilarOperations, type SimilarOptions } from '../core/similar';
  import Icon from './Icon.svelte';

  // Operations similar to one you ticked: tick the ones to add to the selection, then go back to it
  let { tx, onclose }: { tx: Transaction; onclose: () => void } = $props();

  const data = $derived(app.data!);
  let opts = $state<SimilarOptions>({ ...DEFAULT_SIMILAR });
  const list = $derived(findSimilarOperations(data, tx, opts));
  const picked = $derived(new Set(app.selection ?? []));
  const tickedHere = $derived(list.filter((t) => picked.has(t.id)).length);
  const allTicked = $derived(list.length > 0 && tickedHere === list.length);
  const acc = (id: string) => data.accounts.find((a) => a.id === id);
  const catName = (id: string | null) => (id ? data.categories.find((c) => c.id === id)?.name ?? '' : 'not categorized');

  function toggle(t: Transaction) {
    if (!app.selection) return;
    app.selection = picked.has(t.id) ? app.selection.filter((id) => id !== t.id) : [...app.selection, t.id];
  }
  function tickAll() {
    if (!app.selection) return;
    const ids = new Set(list.map((t) => t.id));
    app.selection = allTicked ? app.selection.filter((id) => !ids.has(id) || id === tx.id) : [...new Set([...app.selection, ...ids])];
  }
</script>

<div class="sheet-backdrop" onclick={onclose} role="presentation">
  <div class="sheet" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && onclose()} role="dialog" aria-modal="true" aria-label="Similar operations" tabindex="-1" data-testid="similar-picker">
    <div class="grip"></div>
    <h2 style="margin-bottom: 2px">Similar to {tx.counterparty}</h2>
    <p class="hint" style="margin-top: 0">Tick the ones to add to your selection, then tap Done to go back to it.</p>

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

    {#if list.length <= 1}
      <p class="muted">No other similar operation. Try "Similar amount" or untick "Same or similar name".</p>
    {:else}
      <div class="row" style="margin: 4px 0 6px">
        <span class="hint" style="margin: 0">{list.length} operations, {tickedHere} ticked</span>
        <button class="small ghost" onclick={tickAll}>{allTicked ? 'Untick all' : 'Tick all'}</button>
      </div>
      <div class="card" style="padding: 0 10px">
        <ul class="list">
          {#each list as t (t.id)}
            <li>
              <button class="tx pick" class:on={picked.has(t.id)} onclick={() => toggle(t)} aria-pressed={picked.has(t.id)}>
                <span class="tick" class:on={picked.has(t.id)} aria-hidden="true">{#if picked.has(t.id)}<Icon name="check" size={16} />{/if}</span>
                <span class="accbar" style="background: var(--acc-{acc(t.accountId)?.color ?? 1})"></span>
                <div class="main">
                  <div class="name">{t.counterparty}{t.id === tx.id ? ' (this one)' : ''}</div>
                  <div class="sub">{formatDay(t.opDate ?? t.date)} · {catName(t.categoryId)} · {acc(t.accountId)?.name}</div>
                </div>
                <div class="amt num" class:in={t.amount > 0}>{formatCents(t.amount, t.currency, { sign: true })}</div>
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
    <button class="block" style="margin-top: 10px" onclick={onclose}>Done, {app.selection?.length ?? 0} selected</button>
  </div>
</div>

<style>
  .tick { flex: none; width: 24px; height: 24px; border-radius: 7px; border: 2px solid var(--line); display: grid; place-items: center; color: var(--accent-ink); }
  .tick.on { background: var(--accent); border-color: var(--accent); }
  .pick { padding-left: 6px; padding-right: 6px; border-radius: 10px; }
  .pick.on { background: var(--accent-soft); }
</style>
