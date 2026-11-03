// Data for the Charts tab: one filter, many views.

import { monthOf } from './dates';
import type { Category, Transaction, VaultData } from './model';
import { kindOf } from './summary';
import { normalizeKey } from './text';

export interface ChartFilter {
  from: string; // yyyy-mm, inclusive
  to: string; // yyyy-mm, inclusive
  accountIds: string[]; // empty means all
  categoryIds: string[]; // empty means all, '__none' for not categorized
  kind: 'expense' | 'income';
  query: string;
  regular: 'all' | 'only' | 'exclude';
}

export interface Item {
  t: Transaction;
  value: number; // positive cents: money spent for expenses, money received for income
}

export function allMonths(data: VaultData): string[] {
  return [...new Set(data.transactions.map((t) => monthOf(t.date)))].sort();
}

export function monthsBetween(from: string, to: string): string[] {
  if (!from || !to || from > to) return [];
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ly, lm] = to.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export function applyFilter(data: VaultData, f: ChartFilter): Item[] {
  const cats = new Map<string, Category>(data.categories.map((c) => [c.id, c]));
  const accounts = f.accountIds.length ? new Set(f.accountIds) : null;
  const categories = f.categoryIds.length ? new Set(f.categoryIds) : null;
  const q = normalizeKey(f.query.trim());
  const out: Item[] = [];
  for (const t of data.transactions) {
    const m = monthOf(t.date);
    if (m < f.from || m > f.to) continue;
    if (accounts && !accounts.has(t.accountId)) continue;
    if (categories && !categories.has(t.categoryId ?? '__none')) continue;
    if (kindOf(t, cats) !== f.kind) continue;
    if (f.regular === 'only' && !t.recurringId) continue;
    if (f.regular === 'exclude' && t.recurringId) continue;
    if (q && !normalizeKey(t.counterparty + ' ' + t.detail + ' ' + (t.note ?? '')).includes(q)) continue;
    out.push({ t, value: f.kind === 'expense' ? -t.amount : t.amount });
  }
  return out;
}

export function monthlyTotals(items: Item[], months: string[]): number[] {
  const idx = new Map(months.map((m, i) => [m, i]));
  const v = months.map(() => 0);
  for (const it of items) {
    const i = idx.get(monthOf(it.t.date));
    if (i !== undefined) v[i] += it.value;
  }
  return v;
}

export interface Series {
  id: string;
  name: string;
  values: number[];
}

/** One series per category (the largest ones), the rest grouped as Other. */
export function monthlyByCategory(data: VaultData, items: Item[], months: string[], top = 6): Series[] {
  const totals = new Map<string, number>();
  for (const it of items) totals.set(it.t.categoryId ?? '__none', (totals.get(it.t.categoryId ?? '__none') ?? 0) + it.value);
  const order = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const keep = order.slice(0, top);
  const idx = new Map(months.map((m, i) => [m, i]));
  const series = new Map<string, Series>();
  const nameOf = (id: string) => (id === '__none' ? 'Not categorized' : data.categories.find((c) => c.id === id)?.name ?? id);
  for (const id of keep) series.set(id, { id, name: nameOf(id), values: months.map(() => 0) });
  const other: Series = { id: '__other', name: 'Other', values: months.map(() => 0) };
  for (const it of items) {
    const i = idx.get(monthOf(it.t.date));
    if (i === undefined) continue;
    const s = series.get(it.t.categoryId ?? '__none') ?? other;
    s.values[i] += it.value;
  }
  const out = [...series.values()];
  if (other.values.some((v) => v)) out.push(other);
  return out;
}

export interface Row {
  id: string;
  label: string;
  value: number;
  count: number;
}

export function byCategory(data: VaultData, items: Item[]): Row[] {
  const map = new Map<string, Row>();
  for (const it of items) {
    const id = it.t.categoryId ?? '__none';
    const r = map.get(id) ?? { id, label: id === '__none' ? 'Not categorized' : data.categories.find((c) => c.id === id)?.name ?? id, value: 0, count: 0 };
    r.value += it.value;
    r.count++;
    map.set(id, r);
  }
  return [...map.values()].filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
}

export function byMerchant(items: Item[], limit = 12): Row[] {
  const map = new Map<string, Row>();
  for (const it of items) {
    const id = it.t.merchantKey || it.t.counterparty;
    const r = map.get(id) ?? { id, label: it.t.counterparty, value: 0, count: 0 };
    r.value += it.value;
    r.count++;
    map.set(id, r);
  }
  return [...map.values()].filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, limit);
}

export function byAccount(data: VaultData, items: Item[]): Row[] {
  const map = new Map<string, Row>();
  for (const it of items) {
    const a = data.accounts.find((x) => x.id === it.t.accountId);
    const r = map.get(it.t.accountId) ?? { id: it.t.accountId, label: a?.name ?? '', value: 0, count: 0 };
    r.value += it.value;
    r.count++;
    map.set(it.t.accountId, r);
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Total and number of payments per day of the week (purchase date when known). */
export function byWeekday(items: Item[]): { total: number[]; count: number[] } {
  const total = Array(7).fill(0);
  const count = Array(7).fill(0);
  for (const it of items) {
    const d = new Date((it.t.opDate ?? it.t.date) + 'T00:00:00Z').getUTCDay();
    const i = (d + 6) % 7;
    total[i] += it.value;
    count[i]++;
  }
  return { total, count };
}

export const SIZE_BINS: [number, number, string][] = [
  [0, 1000, 'under 10 €'],
  [1000, 2000, '10 to 20'],
  [2000, 5000, '20 to 50'],
  [5000, 10000, '50 to 100'],
  [10000, 20000, '100 to 200'],
  [20000, 50000, '200 to 500'],
  [50000, Infinity, '500 and more'],
];

export function sizeDistribution(items: Item[]): { labels: string[]; count: number[]; total: number[] } {
  const count = SIZE_BINS.map(() => 0);
  const total = SIZE_BINS.map(() => 0);
  for (const it of items) {
    const i = SIZE_BINS.findIndex(([lo, hi]) => it.value >= lo && it.value < hi);
    if (i >= 0) {
      count[i]++;
      total[i] += it.value;
    }
  }
  return { labels: SIZE_BINS.map((b) => b[2]), count, total };
}

/** Cumulative amount by day of the month for one month, and the average of the other months. */
export function monthPace(items: Item[], month: string, months: string[]): { days: number[]; current: number[]; average: number[] } {
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const cum = (list: Item[]) => {
    const per = Array(31).fill(0);
    for (const it of list) per[Number(it.t.date.slice(8, 10)) - 1] += it.value;
    let s = 0;
    return per.map((v) => (s += v));
  };
  const current = cum(items.filter((it) => monthOf(it.t.date) === month));
  const others = months.filter((m) => m !== month);
  const sums = Array(31).fill(0);
  for (const m of others) cum(items.filter((it) => monthOf(it.t.date) === m)).forEach((v, i) => (sums[i] += v));
  const average = sums.map((v) => (others.length ? Math.round(v / others.length) : 0));
  return { days, current, average };
}

/**
 * Month end balance of an account, rebuilt from its latest bank balance by undoing the
 * operations that came after each month end.
 */
export function balanceHistory(data: VaultData, accountId: string, months: string[]): (number | null)[] {
  const snaps = data.balances.filter((b) => b.accountId === accountId).sort((a, b) => b.date.localeCompare(a.date));
  if (!snaps.length) return months.map(() => null);
  const snap = snaps[0];
  const txs = data.transactions.filter((t) => t.accountId === accountId);
  const first = txs.reduce((min, t) => (t.date < min ? t.date : min), snap.date);
  return months.map((m) => {
    const end = monthEnd(m);
    if (end < monthOf(first) + '-01') return null;
    let b = snap.amount;
    if (end < snap.date) {
      for (const t of txs) if (t.date > end && t.date <= snap.date) b -= t.amount;
    } else {
      for (const t of txs) if (t.date > snap.date && t.date <= end) b += t.amount;
    }
    return b;
  });
}

function monthEnd(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
}
