<script lang="ts">
  import { niceScale, shortMoney, thin } from './scale';

  interface S { name: string; values: number[]; color: string }
  let {
    labels,
    series,
    stacked = false,
    height = 170,
    format,
    axis = shortMoney,
    readoutLabels,
  }: {
    labels: string[];
    series: S[];
    stacked?: boolean;
    height?: number;
    format: (v: number) => string;
    axis?: (v: number) => string;
    readoutLabels?: string[];
  } = $props();

  let selected = $state<number | null>(null);
  const totals = $derived(labels.map((_, i) => series.reduce((s, x) => s + Math.max(0, x.values[i] ?? 0), 0)));
  const max = $derived(stacked ? Math.max(0, ...totals) : Math.max(0, ...series.flatMap((s) => s.values)));
  const scale = $derived(niceScale(max));
  const pct = (v: number) => `${(Math.max(0, v) / scale.top) * 100}%`;
</script>

<div class="bc">
  <div class="plot" style="height: {height}px">
    {#each scale.ticks as t}
      <div class="grid" style="bottom: {(t / scale.top) * 100}%"><span>{axis(t)}</span></div>
    {/each}
    <div class="cols">
      {#each labels as l, i}
        <button class="col" class:on={selected === i} onclick={() => (selected = selected === i ? null : i)} aria-label="{readoutLabels?.[i] ?? l}: {series.map((s) => s.name + ' ' + format(s.values[i] ?? 0)).join(', ')}">
          {#if stacked}
            <div class="bstack">
              {#each series as s}
                {#if (s.values[i] ?? 0) > 0}<div class="bseg" style="height: {pct(s.values[i])}; background: {s.color}"></div>{/if}
              {/each}
            </div>
          {:else}
            <div class="group">
              {#each series as s}
                <div class="bar" style="height: {pct(s.values[i] ?? 0)}; background: {s.color}"></div>
              {/each}
            </div>
          {/if}
        </button>
      {/each}
    </div>
  </div>
  <div class="xlabels">
    {#each labels as l, i}<span>{thin(i, labels.length, 8) ? l : ''}</span>{/each}
  </div>
  {#if series.length > 1}
    <div class="legend">
      {#each series as s}<span><i style="background: {s.color}"></i>{s.name}</span>{/each}
    </div>
  {/if}
  <div class="readout" aria-live="polite">
    {#if selected !== null}
      <strong>{readoutLabels?.[selected] ?? labels[selected]}</strong>
      {#if series.length === 1}
        {format(series[0].values[selected] ?? 0)}
      {:else}
        {#each series.filter((s) => (s.values[selected!] ?? 0) !== 0) as s}<span class="ri"><i style="background: {s.color}"></i>{s.name} {format(s.values[selected] ?? 0)}</span>{/each}
        {#if stacked}<span class="ri">Total {format(totals[selected])}</span>{/if}
      {/if}
    {:else}
      <span class="muted">Tap a bar to see its values</span>
    {/if}
  </div>
</div>

<style>
  .bc { font-size: 0.75rem; }
  .plot { position: relative; margin-left: 42px; }
  .grid { position: absolute; left: 0; right: 0; border-top: 1px solid var(--line); }
  .grid span { position: absolute; right: calc(100% + 6px); top: -0.6em; color: var(--muted); white-space: nowrap; }
  .cols { position: absolute; inset: 0; display: flex; gap: 2px; align-items: stretch; }
  .col { flex: 1; min-width: 0; padding: 0; min-height: 0; background: none; border-radius: 4px; display: flex; align-items: flex-end; justify-content: center; }
  .col.on { background: var(--surface-2); }
  .bstack { width: 70%; max-width: 26px; height: 100%; display: flex; flex-direction: column-reverse; border-radius: 4px 4px 0 0; overflow: hidden; }
  .bseg { flex: none; box-sizing: border-box; border-top: 2px solid var(--surface); }
  .bseg:last-child { border-radius: 4px 4px 0 0; }
  .group { width: 80%; max-width: 30px; height: 100%; display: flex; align-items: flex-end; justify-content: center; gap: 2px; }
  .bar { flex: 1; max-width: 14px; border-radius: 4px 4px 0 0; min-height: 0; }
  .xlabels { display: flex; gap: 2px; margin-left: 42px; margin-top: 4px; color: var(--muted); }
  .xlabels span { flex: 1; min-width: 0; text-align: center; white-space: nowrap; overflow: visible; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 8px; color: var(--text); }
  .legend i, .ri i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
  .readout { margin-top: 8px; min-height: 1.5em; font-size: 0.85rem; display: flex; flex-wrap: wrap; gap: 4px 12px; }
</style>
