<script lang="ts">
  import { app } from './app.svelte';

  // Pick one or several accounts; none picked means all of them
  let { selected = $bindable([]), label = 'Accounts' }: { selected?: string[]; label?: string } = $props();

  const accounts = $derived(app.data?.accounts ?? []);

  function toggle(id: string) {
    selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    if (selected.length === accounts.length) selected = [];
  }
</script>

{#if accounts.length > 1}
  <div class="chips" role="group" aria-label={label} style="margin-bottom: 10px">
    <button class="chip" class:on={!selected.length} aria-pressed={!selected.length} onclick={() => (selected = [])}>All accounts</button>
    {#each accounts as a (a.id)}
      <button class="chip" class:on={selected.includes(a.id)} aria-pressed={selected.includes(a.id)} onclick={() => toggle(a.id)}>
        <span class="accdot" style="background: var(--acc-{a.color ?? 1})"></span>{a.name}
      </button>
    {/each}
  </div>
{/if}
