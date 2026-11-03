// Operations similar to a given one: same or similar name, and or a similar amount.

import { monthOf } from './dates';
import type { Transaction, VaultData } from './model';
import { normalizeKey } from './text';

export interface SimilarOptions {
  byName: boolean;
  byAmount: boolean;
  amountTolerance: number; // 0.15 means within 15 percent
}

export const DEFAULT_SIMILAR: SimilarOptions = { byName: true, byAmount: false, amountTolerance: 0.15 };

const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'a', 'au', 'sa', 'sas', 'sarl', 'the', 'and', 'mr', 'mme', 'm', 'mlle', 'com', 'www', 'fr']);

function words(s: string): Set<string> {
  return new Set(
    normalizeKey(s)
      .replace(/[^a-z ]/g, ' ')
      .split(' ')
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

/** 1 for the same merchant, otherwise the share of common words in the names. */
export function nameSimilarity(a: Transaction, b: Transaction): number {
  if (a.merchantKey && a.merchantKey === b.merchantKey) return 1;
  const wa = words(a.counterparty);
  const wb = words(b.counterparty);
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / Math.min(wa.size, wb.size);
}

export function amountClose(a: number, b: number, tol: number): boolean {
  if (Math.sign(a) !== Math.sign(b)) return false;
  const base = Math.max(Math.abs(a), 1);
  return Math.abs(Math.abs(a) - Math.abs(b)) / base <= tol;
}

/** Similar operations, newest first, including the one you started from. */
export function findSimilarOperations(data: VaultData, tx: Transaction, opts: SimilarOptions = DEFAULT_SIMILAR): Transaction[] {
  if (!opts.byName && !opts.byAmount) return [tx];
  return data.transactions.filter((t) => {
    if (t.id === tx.id) return true;
    if (Math.sign(t.amount) !== Math.sign(tx.amount)) return false;
    const nameOk = !opts.byName || nameSimilarity(tx, t) >= 0.6;
    const amountOk = !opts.byAmount || amountClose(tx.amount, t.amount, opts.amountTolerance);
    return nameOk && amountOk;
  });
}

export interface SimilarStats {
  count: number;
  total: number; // signed cents
  average: number;
  min: number;
  max: number;
  first: string;
  last: string;
  months: number; // months between first and last, at least 1
  perMonth: number; // signed cents per month over that span
}

export function similarStats(list: Transaction[]): SimilarStats | null {
  if (!list.length) return null;
  const dates = list.map((t) => t.opDate ?? t.date).sort();
  const total = list.reduce((s, t) => s + t.amount, 0);
  const abs = list.map((t) => Math.abs(t.amount));
  const first = dates[0];
  const last = dates[dates.length - 1];
  const months = Math.max(1, (Number(last.slice(0, 4)) - Number(first.slice(0, 4))) * 12 + Number(last.slice(5, 7)) - Number(first.slice(5, 7)) + 1);
  const sign = Math.sign(total) || 1;
  return {
    count: list.length,
    total,
    average: Math.round(total / list.length),
    min: sign * Math.min(...abs),
    max: sign * Math.max(...abs),
    first,
    last,
    months,
    perMonth: Math.round(total / months),
  };
}

/** Monthly totals of a list, over every month from the first to the last (empty months at 0). */
export function monthlySeries(list: Transaction[]): { months: string[]; values: number[] } {
  if (!list.length) return { months: [], values: [] };
  const sorted = list.map((t) => monthOf(t.date)).sort();
  const months: string[] = [];
  let [y, m] = sorted[0].split('-').map(Number);
  const [ly, lm] = sorted[sorted.length - 1].split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  const idx = new Map(months.map((mo, i) => [mo, i]));
  const values = months.map(() => 0);
  for (const t of list) values[idx.get(monthOf(t.date))!] += Math.abs(t.amount);
  return { months, values };
}
