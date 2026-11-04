<script lang="ts">
  import { untrack } from 'svelte';
  import { app, persist, toast } from './app.svelte';
  import { addCategory, KIND_LABELS } from '../core/categories';
  import type { CategoryKind } from '../core/model';

  // A category picker with "New category" at the end. value: a category id, null for
  // "Not categorized", or '' when nothing is picked yet (with a placeholder).
  let {
    value = $bindable(null),
    placeholder = '',
    allowNone = true,
    kinds,
    allowNew = true,
    id,
    label,
    disabled = false,
    exclude,
    onpick,
  }: {
    value?: string | null;
    placeholder?: string;
    allowNone?: boolean;
    kinds?: CategoryKind[];
    allowNew?: boolean;
    id?: string;
    label?: string;
    disabled?: boolean;
    exclude?: string;
    onpick?: (v: string | null) => void;
  } = $props();

  const data = $derived(app.data!);
  const GROUPS: { label: string; kinds: CategoryKind[] }[] = [
    { label: 'Spending', kinds: ['expense'] },
    { label: 'Income', kinds: ['income'] },
    { label: 'Other', kinds: ['savings', 'transfer'] },
  ];
  const groups = $derived(
    GROUPS.map((g) => ({ label: g.label, cats: data.categories.filter((c) => c.id !== exclude && g.kinds.includes(c.kind) && (!kinds || kinds.includes(c.kind))) })).filter((g) => g.cats.length),
  );
  const newKinds = $derived((kinds ?? ['expense', 'income', 'savings']).filter((k) => k !== 'transfer') as CategoryKind[]);
  const selValue = $derived(value === null ? '__none' : value);

  let creating = $state(false);
  let newName = $state('');
  let newKind = $state<CategoryKind>(untrack(() => (kinds?.[0] && kinds[0] !== 'transfer' ? kinds[0] : 'expense')));
  let error = $state('');

  function onChange(e: Event) {
    const el = e.target as HTMLSelectElement;
    const v = el.value;
    if (v === '__new') {
      el.value = selValue;
      creating = true;
      error = '';
      if (!newKinds.includes(newKind)) newKind = newKinds[0];
      return;
    }
    const out = v === '__none' ? null : v;
    value = out;
    onpick?.(out);
  }

  function create(e?: Event) {
    e?.preventDefault();
    try {
      const c = addCategory(data, newName, newKind);
      persist();
      toast(`${c.name} added`);
      creating = false;
      newName = '';
      value = c.id;
      onpick?.(c.id);
    } catch (err) {
      error = (err as Error).message;
    }
  }
</script>

<select {id} aria-label={label} value={selValue} onchange={onChange} {disabled}>
  {#if placeholder}<option value="">{placeholder}</option>{/if}
  {#if allowNone}<option value="__none">Not categorized</option>{/if}
  {#each groups as g (g.label)}
    <optgroup label={g.label}>{#each g.cats as c (c.id)}<option value={c.id}>{c.name}</option>{/each}</optgroup>
  {/each}
  {#if allowNew}<option value="__new">New category…</option>{/if}
</select>

{#if creating}
  <div class="newcat" data-testid="new-category">
    <input bind:value={newName} placeholder="Name of the new category" aria-label="Name of the new category" onkeydown={(e) => e.key === 'Enter' && create(e)} />
    <div class="row" style="gap: 8px; margin-top: 6px">
      {#if newKinds.length > 1}
        <select bind:value={newKind} aria-label="Kind of category" style="flex: 1">
          {#each newKinds as k}<option value={k}>{KIND_LABELS[k]}</option>{/each}
        </select>
      {/if}
      <button type="button" class="small secondary" onclick={() => (creating = false)}>Cancel</button>
      <button type="button" class="small" disabled={!newName.trim()} onclick={() => create()}>Add</button>
    </div>
    {#if error}<div class="notice bad" style="margin: 6px 0 0">{error}</div>{/if}
  </div>
{/if}

<style>
  .newcat { margin-top: 8px; padding: 10px; border: 1px dashed var(--line); border-radius: 12px; background: var(--surface); }
</style>
