<script lang="ts">
  import { app, persist, toast } from './app.svelte';
  import { addCategory, categoryUse, deleteCategory, KIND_LABELS, PROTECTED_CATEGORIES, renameCategory } from '../core/categories';
  import { linkSeries } from '../core/recurring';
  import type { CategoryKind } from '../core/model';
  import CategorySelect from './CategorySelect.svelte';

  const data = $derived(app.data!);
  let newName = $state('');
  let newKind = $state<CategoryKind>('expense');
  let addError = $state('');
  let open = $state<string | null>(null);
  let renameError = $state('');
  let deleting = $state(false);
  let moveTo = $state<string | null>(null);

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
    deleting = false;
    moveTo = null;
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
    const name = data.categories.find((c) => c.id === id)?.name;
    const n = deleteCategory(data, id, moveTo);
    linkSeries(data);
    persist();
    toast(`${name} deleted${n ? `, ${n} operation${n === 1 ? '' : 's'} moved` : ''}`);
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
              <p class="hint">The app uses this category for transfers between your accounts, so it cannot be deleted.</p>
            {:else if !deleting}
              <button class="small ghost danger-text" style="padding-left: 0; margin-top: 6px" onclick={() => (deleting = true)}>Delete this category</button>
            {:else}
              {@const use = categoryUse(data, c.id)}
              <p style="margin: 10px 0 6px; font-size: 0.92rem">
                {#if use.operations || use.rules || use.regular}
                  Used by {use.operations} operation{use.operations === 1 ? '' : 's'}{use.rules ? `, ${use.rules} rule${use.rules === 1 ? '' : 's'}` : ''}{use.regular ? `, ${use.regular} regular payment${use.regular === 1 ? '' : 's'}` : ''}. Move them to:
                {:else}
                  Not used by any operation.
                {/if}
              </p>
              {#if use.operations || use.rules || use.regular}
                <CategorySelect bind:value={moveTo} allowNew={false} exclude={c.id} label="Move them to" />
                <p class="hint" style="margin: 4px 0 0">Choosing another category merges the two. "Not categorized" puts the operations back in your To do list.</p>
              {/if}
              <div class="row" style="gap: 8px; margin-top: 8px">
                <button class="small secondary" onclick={() => (deleting = false)}>Cancel</button>
                <button class="small danger" onclick={() => remove(c.id)}>Delete {c.name}</button>
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
</style>
