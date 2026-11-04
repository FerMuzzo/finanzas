<script lang="ts">
  import { app, persist, toast } from './app.svelte';
  import { addCategory, categoryUse, deleteCategory, KIND_LABELS, mergeCategories, mergeTargets, PROTECTED_CATEGORIES, renameCategory } from '../core/categories';
  import { linkSeries } from '../core/recurring';
  import type { CategoryKind } from '../core/model';
  import CategorySelect from './CategorySelect.svelte';

  const data = $derived(app.data!);
  let newName = $state('');
  let newKind = $state<CategoryKind>('expense');
  let addError = $state('');
  let open = $state<string | null>(null);
  let renameError = $state('');
  let action = $state<'' | 'merge' | 'delete'>('');
  let mergeInto = $state<string | null>('');
  let actionError = $state('');

  const counts = $derived.by(() => {
    const m = new Map<string, number>();
    for (const t of data.transactions) if (t.categoryId) m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + 1);
    return m;
  });
  const KINDS: CategoryKind[] = ['expense', 'income', 'savings', 'transfer'];
  const grouped = $derived(KINDS.map((k) => ({ kind: k, cats: data.categories.filter((c) => c.kind === k) })).filter((g) => g.cats.length));

  function add(e: SubmitEvent) {
    e.preventDefault();
    addError = '';
    try {
      const c = addCategory(data, newName, newKind);
      persist();
      toast(`${c.name} added`);
      newName = '';
    } catch (err) {
      addError = (err as Error).message;
    }
  }

  function toggle(id: string) {
    open = open === id ? null : id;
    renameError = '';
    startAction('');
  }
  function startAction(a: '' | 'merge' | 'delete') {
    action = a;
    mergeInto = '';
    actionError = '';
  }
  const nameOf = (id: string | null) => data.categories.find((c) => c.id === id)?.name ?? '';
  function useText(id: string): string {
    const use = categoryUse(data, id);
    const parts = [`${use.operations} operation${use.operations === 1 ? '' : 's'}`];
    if (use.rules) parts.push(`${use.rules} rule${use.rules === 1 ? '' : 's'}`);
    if (use.regular) parts.push(`${use.regular} regular payment${use.regular === 1 ? '' : 's'}`);
    return parts.join(', ');
  }

  function merge(id: string) {
    if (!mergeInto) return;
    const from = nameOf(id);
    const into = nameOf(mergeInto);
    try {
      const n = mergeCategories(data, id, mergeInto);
      linkSeries(data);
      persist();
      toast(`${from} merged into ${into}${n ? `, ${n} operation${n === 1 ? '' : 's'} moved` : ''}`);
      open = mergeInto;
      startAction('');
    } catch (err) {
      actionError = (err as Error).message;
    }
  }

  function rename(id: string, e: Event) {
    renameError = '';
    try {
      renameCategory(data, id, (e.target as HTMLInputElement).value);
      persist();
    } catch (err) {
      renameError = (err as Error).message;
    }
  }

  function remove(id: string) {
    const name = nameOf(id);
    const n = deleteCategory(data, id, null);
    linkSeries(data);
    persist();
    toast(`${name} deleted${n ? `, ${n} operation${n === 1 ? '' : 's'} not categorized now` : ''}`);
    open = null;
  }
</script>

<form onsubmit={add} class="row" style="gap: 8px; align-items: stretch">
  <input bind:value={newName} placeholder="New category" aria-label="New category name" style="flex: 2; min-width: 0" />
  <select bind:value={newKind} aria-label="Kind of the new category" style="flex: 1; min-width: 0">
    <option value="expense">Spending</option>
    <option value="income">Income</option>
    <option value="savings">Savings</option>
  </select>
  <button type="submit" disabled={!newName.trim()}>Add</button>
</form>
{#if addError}<div class="notice bad" style="margin: 8px 0 0">{addError}</div>{/if}

{#each grouped as g (g.kind)}
  <p class="kindhead">{KIND_LABELS[g.kind]}</p>
  <ul class="list">
    {#each g.cats as c (c.id)}
      <li>
        <button class="catline" onclick={() => toggle(c.id)} aria-expanded={open === c.id}>
          <span>{c.name}</span>
          <small class="muted">{counts.get(c.id) ?? 0}</small>
        </button>
        {#if open === c.id}
          <div class="edit" data-testid="category-edit">
            <label for="rn-{c.id}" class="hint" style="display: block; margin: 0 0 4px">Name</label>
            <input id="rn-{c.id}" value={c.name} onchange={(e) => rename(c.id, e)} />
            {#if renameError}<div class="notice bad" style="margin: 6px 0 0">{renameError}</div>{/if}
            {#if PROTECTED_CATEGORIES.has(c.id)}
              <p class="hint">The app uses this category for transfers between your accounts, so it cannot be merged or deleted.</p>
            {:else if action === ''}
              <div class="row" style="gap: 8px; margin-top: 8px; justify-content: flex-start">
                <button class="small secondary" onclick={() => startAction('merge')}>Merge into another</button>
                <button class="small ghost danger-text" onclick={() => startAction('delete')}>Delete</button>
              </div>
            {:else if action === 'merge'}
              {@const targets = mergeTargets(data, c.id)}
              <div class="panel" data-testid="merge-panel">
                <p style="margin: 0 0 6px; font-weight: 600">Merge {c.name} into</p>
                {#if targets.length}
                  <CategorySelect bind:value={mergeInto} kinds={[c.kind]} exclude={c.id} allowNone={false} allowNew={false} placeholder="Choose a category" label="Merge into" />
                  {#if mergeInto}
                    <p class="hint" style="margin: 8px 0 0">Its {useText(c.id)} move to {nameOf(mergeInto)}, and so do the merchants the app learned for it. {c.name} disappears; {nameOf(mergeInto)} keeps its name, which you can change afterwards.</p>
                  {:else}
                    <p class="hint" style="margin: 8px 0 0">Only {KIND_LABELS[c.kind].toLowerCase()} categories are listed, so totals stay right.</p>
                  {/if}
                {:else}
                  <p class="hint">There is no other {KIND_LABELS[c.kind].toLowerCase()} category to merge it into.</p>
                {/if}
                {#if actionError}<div class="notice bad" style="margin: 6px 0 0">{actionError}</div>{/if}
                <div class="row" style="gap: 8px; margin-top: 10px">
                  <button class="small secondary" onclick={() => startAction('')}>Cancel</button>
                  <button class="small" disabled={!mergeInto} onclick={() => merge(c.id)}>{mergeInto ? `Merge into ${nameOf(mergeInto)}` : 'Merge'}</button>
                </div>
              </div>
            {:else}
              <div class="panel" data-testid="delete-panel">
                <p style="margin: 0; font-size: 0.92rem">
                  {#if categoryUse(data, c.id).operations}
                    Its {categoryUse(data, c.id).operations} operation{categoryUse(data, c.id).operations === 1 ? '' : 's'} become not categorized and go back to your To do list. To keep them together in another category, merge instead.
                  {:else}
                    No operation uses it.
                  {/if}
                </p>
                <div class="row" style="gap: 8px; margin-top: 10px">
                  <button class="small secondary" onclick={() => startAction('')}>Cancel</button>
                  <button class="small danger" onclick={() => remove(c.id)}>Delete {c.name}</button>
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/each}

<style>
  .kindhead { margin: 14px 0 2px; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
  .catline { display: flex; justify-content: space-between; width: 100%; background: none; color: inherit; padding: 9px 0; min-height: 0; font-weight: 500; border-radius: 0; text-align: left; }
  .edit { padding: 2px 0 12px; }
  .danger-text { color: var(--bad); }
  .panel { margin-top: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
</style>
