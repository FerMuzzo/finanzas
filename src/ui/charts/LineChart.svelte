<script lang="ts">
  import { niceScale, shortMoney, thin } from './scale';

  interface S { name: string; values: (number | null)[]; color: string; dashed?: boolean }
  let {
    labels,
    series,
    height = 170,
    format,
    axis = shortMoney,
    readoutLabels,
    zeroBased = true,
  }: {
    labels: string[];
    series: S[];
    height?: number;
    format: (v: number) => string;
    axis?: (v: number) => string;
    readoutLabels?: string[];
    zeroBased?: boolean;
  } = $props();

  let selected = $state<number | null>(null);
  const vals = $derived(series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
  const lo = $derived(zeroBased ? Math.min(0, ...vals) : Math.min(...vals));
  const hiRaw = $derived(Math.max(...vals, lo + 1));
  const scale = $derived(niceScale(hiRaw - lo));
  const top = $derived(lo + scale.top);
  const n = $derived(labels.length);
  const x = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => 100 - ((v - lo) / (top - lo)) * 100;

  function path(values: (number | null)[]): string {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`;
      pen = true;
    });
    return d;
  }
</script>

<div class="lc">
  <div class="plot" style="height: {height}px">
    {#each scale.ticks as t}
      <div class="grid" style="bottom: {(t / scale.top) * 100}%"><span>{axis(lo + t)}</span></div>
    {/each}
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {#each series as s}
        <path d={path(s.values)} fill="none" stroke={s.color} stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray={s.dashed ? '5 4' : undefined} />
      {/each}
      {#if selected !== null}
        <line x1={x(selected)} x2={x(selected)} y1="0" y2="100" stroke="currentColor" stroke-opacity="0.25" stroke-width="1" vector-effect="non-scaling-stroke" />
      {/if}
    </svg>
    {#if selected !== null}
      {#each series as s}
        {#if s.values[selected] !== null && s.values[selected] !== undefined}
          <span class="dot" style="left: {x(selected)}%; top: {y(s.values[selected] as number)}%; background: {s.color}"></span>
        {/if}
      {/each}
    {/if}
    <div class="hits">
      {#each labels as l, i}
        <button class="hit" onclick={() => (selected = selected === i ? null : i)} aria-label="{readoutLabels?.[i] ?? l}: {series.map((s) => s.name + ' ' + (s.values[i] === null ? 'none' : format(s.values[i] as number))).join(', ')}"></button>
      {/each}
    </div>
  </div>
  <div class="xlabels">
    {#each labels as l, i}
      {#if thin(i, n)}<span style="left: {x(i)}%">{l}</span>{/if}
    {/each}
  </div>
  {#if series.length > 1}
    <div class="legend">
      {#each series as s}<span><i style="background: {s.color}" class:dashed={s.dashed}></i>{s.name}</span>{/each}
    </div>
  {/if}
  <div class="readout" aria-live="polite">
    {#if selected !== null}
      <strong>{readoutLabels?.[selected] ?? labels[selected]}</strong>
      {#each series as s}
        {#if s.values[selected] !== null && s.values[selected] !== undefined}<span class="ri"><i style="background: {s.color}"></i>{series.length > 1 ? s.name + ' ' : ''}{format(s.values[selected] as number)}</span>{/if}
      {/each}
    {:else}
      <span class="muted">Tap the chart to see values</span>
    {/if}
  </div>
</div>

<style>
  .lc { font-size: 0.75rem; }
  .plot { position: relative; margin: 6px 6px 0 42px; }
  svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; color: var(--text); }
  .grid { position: absolute; left: 0; right: 0; border-top: 1px solid var(--line); }
  .grid span { position: absolute; right: calc(100% + 6px); top: -0.6em; color: var(--muted); white-space: nowrap; }
  .dot { position: absolute; width: 10px; height: 10px; border-radius: 50%; transform: translate(-50%, -50%); box-shadow: 0 0 0 2px var(--surface); pointer-events: none; }
  .hits { position: absolute; inset: 0; display: flex; }
  .hit { flex: 1; min-width: 0; min-height: 0; padding: 0; background: transparent; border-radius: 0; }
  .xlabels { position: relative; height: 1.4em; margin: 4px 6px 0 42px; color: var(--muted); }
  .xlabels span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 8px; color: var(--text); }
  .legend i, .ri i { display: inline-block; width: 12px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: 3px; }
  .legend i.dashed { background-image: linear-gradient(90deg, transparent 50%, var(--surface) 50%); background-size: 6px 3px; }
  .readout { margin-top: 8px; min-height: 1.5em; font-size: 0.85rem; display: flex; flex-wrap: wrap; gap: 4px 12px; }
</style>
