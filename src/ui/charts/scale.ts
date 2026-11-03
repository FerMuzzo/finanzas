// Small helpers shared by the charts.

/** A "nice" maximum for the axis and 3 tick values. */
export function niceScale(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 1, ticks: [0] };
  const raw = max / 3;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const top = step * Math.ceil(max / step);
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  return { top, ticks };
}

/** Short money label for axes: cents to "1,2 k€" or "350 €". */
export function shortMoney(cents: number): string {
  const e = cents / 100;
  const a = Math.abs(e);
  if (a >= 10000) return `${Math.round(e / 1000)} k€`;
  if (a >= 1000) return `${(e / 1000).toFixed(1).replace('.', ',')} k€`;
  return `${Math.round(e)} €`;
}

/** Show at most n labels, evenly spaced. */
export function thin(i: number, count: number, n = 6): boolean {
  if (count <= n) return true;
  const step = Math.ceil(count / n);
  return i % step === 0 || i === count - 1;
}
