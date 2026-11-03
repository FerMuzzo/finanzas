<script lang="ts">
  interface R { id: string; label: string; value: number; sub?: string; color?: string }
  let { rows, format, onselect }: { rows: R[]; format: (v: number) => string; onselect?: (id: string) => void } = $props();
  const max = $derived(Math.max(1, ...rows.map((r) => r.value)));
  const total = $derived(rows.reduce((s, r) => s + r.value, 0));
</script>

<ul class="hb">
  {#each rows as r (r.id)}
    <li>
      <button class="hrow" onclick={() => onselect?.(r.id)} disabled={!onselect}>
        <div class="top"><span class="lbl">{r.label}</span><span class="num">{format(r.value)}</span></div>
        <div class="top sub"><span>{r.sub ?? ''}</span><span>{total ? Math.round((r.value / total) * 100) : 0}%</span></div>
        <div class="track"><div class="fill" style="width: {(r.value / max) * 100}%; background: {r.color ?? 'var(--c-spend)'}"></div></div>
      </button>
    </li>
  {/each}
</ul>

<style>
  .hb { list-style: none; margin: 0; padding: 0; }
  .hb li + li { border-top: 1px solid var(--line); }
  .hrow { display: block; width: 100%; text-align: left; background: none; color: inherit; padding: 8px 0; border-radius: 0; min-height: 0; font-weight: 400; }
  .hrow:disabled { opacity: 1; cursor: default; }
  .top { display: flex; justify-content: space-between; gap: 10px; }
  .lbl { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { font-size: 0.78rem; color: var(--muted); }
  .track { height: 8px; border-radius: 4px; background: var(--surface-2); margin-top: 4px; overflow: hidden; }
  .fill { height: 100%; border-radius: 4px; }
</style>
