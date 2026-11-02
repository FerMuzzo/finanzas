// Monthly totals and spending breakdowns. Transfers between your own accounts and money moved
// to savings are kept apart from spending and income. A refund put in a spending category
// (for example a returned purchase) reduces that category.

import { monthOf } from './dates';
import type { Category, Transaction, VaultData } from './model';

export interface MonthSummary {
  month: string;
  income: number;
  spending: number;
  savings: number; // net money moved to savings categories
  net: number; // income minus spending
  count: number;
}

export function isInternal(t: Transaction): boolean {
  return !!t.transferId || t.categoryId === 'own_transfer';
}

type Kind = 'income' | 'expense' | 'savings' | 'internal';

export function kindOf(t: Transaction, cats: Map<string, Category>): Kind {
  if (isInternal(t)) return 'internal';
  const c = t.categoryId ? cats.get(t.categoryId) : undefined;
  if (c?.kind === 'savings') return 'savings';
  if (c?.kind === 'transfer') return 'internal';
  if (c?.kind === 'expense') return 'expense';
  if (c?.kind === 'income') return 'income';
  return t.amount < 0 ? 'expense' : 'income';
}

function catMap(data: VaultData): Map<string, Category> {
  return new Map(data.categories.map((c) => [c.id, c]));
}

function accFilter(accountIds?: string[]) {
  const f = accountIds && accountIds.length ? new Set(accountIds) : null;
  return (t: Transaction) => !f || f.has(t.accountId);
}

export function monthlySummaries(data: VaultData, accountIds?: string[]): MonthSummary[] {
  const ok = accFilter(accountIds);
  const cats = catMap(data);
  const map = new Map<string, MonthSummary>();
  for (const t of data.transactions) {
    if (!ok(t)) continue;
    const m = monthOf(t.date);
    let s = map.get(m);
    if (!s) {
      s = { month: m, income: 0, spending: 0, savings: 0, net: 0, count: 0 };
      map.set(m, s);
    }
    s.count++;
    const k = kindOf(t, cats);
    if (k === 'expense') s.spending += -t.amount;
    else if (k === 'income') s.income += t.amount;
    else if (k === 'savings') s.savings += -t.amount;
  }
  for (const s of map.values()) s.net = s.income - s.spending;
  return [...map.values()].sort((a, b) => b.month.localeCompare(a.month));
}

export function latestBalance(data: VaultData, accountId: string): { date: string; amount: number } | null {
  const snaps = data.balances.filter((b) => b.accountId === accountId).sort((a, b) => b.date.localeCompare(a.date));
  return snaps[0] ? { date: snaps[0].date, amount: snaps[0].amount } : null;
}

export interface CategoryTotal {
  categoryId: string | null;
  amount: number; // positive cents spent (total over the months, or average per month)
  count: number;
}

/** Spending per category over one or several months. With average, amounts are per month. */
export function spendingByCategory(data: VaultData, months: string[], opts: { average?: boolean; accountIds?: string[] } = {}): CategoryTotal[] {
  const set = new Set(months);
  const ok = accFilter(opts.accountIds);
  const cats = catMap(data);
  const map = new Map<string | null, CategoryTotal>();
  for (const t of data.transactions) {
    if (!set.has(monthOf(t.date)) || !ok(t) || kindOf(t, cats) !== 'expense') continue;
    const key = t.categoryId;
    const e = map.get(key) ?? { categoryId: key, amount: 0, count: 0 };
    e.amount += -t.amount;
    e.count++;
    map.set(key, e);
  }
  const div = opts.average && months.length ? months.length : 1;
  return [...map.values()]
    .map((e) => ({ ...e, amount: Math.round(e.amount / div), count: e.count / div }))
    .filter((e) => e.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

export interface MerchantTotal {
  key: string;
  name: string;
  amount: number;
  count: number;
  categoryId: string | null;
}

export function topMerchants(data: VaultData, months: string[], opts: { categoryId?: string | null; limit?: number; average?: boolean } = {}): MerchantTotal[] {
  const set = new Set(months);
  const cats = catMap(data);
  const map = new Map<string, MerchantTotal>();
  for (const t of data.transactions) {
    if (!set.has(monthOf(t.date)) || kindOf(t, cats) !== 'expense') continue;
    if (opts.categoryId !== undefined && t.categoryId !== opts.categoryId) continue;
    const e = map.get(t.merchantKey) ?? { key: t.merchantKey, name: t.counterparty, amount: 0, count: 0, categoryId: t.categoryId };
    e.amount += -t.amount;
    e.count++;
    map.set(t.merchantKey, e);
  }
  const div = opts.average && months.length ? months.length : 1;
  return [...map.values()]
    .map((e) => ({ ...e, amount: Math.round(e.amount / div), count: e.count / div }))
    .filter((e) => e.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, opts.limit ?? 10);
}

/** Months fully covered by the data: excludes the current, still open month. */
export function completeMonths(data: VaultData, todayIso: string): string[] {
  const current = todayIso.slice(0, 7);
  const months = new Set(data.transactions.map((t) => monthOf(t.date)));
  return [...months].filter((m) => m < current).sort().reverse();
}

/** Spending of one month split into regular payments you confirmed and everything else. */
export function fixedVersusVariable(data: VaultData, months: string[], average = false): { fixed: number; variable: number } {
  const set = new Set(months);
  const cats = catMap(data);
  let fixed = 0;
  let variable = 0;
  for (const t of data.transactions) {
    if (!set.has(monthOf(t.date)) || kindOf(t, cats) !== 'expense') continue;
    if (t.recurringId) fixed += -t.amount;
    else variable += -t.amount;
  }
  const div = average && months.length ? months.length : 1;
  return { fixed: Math.round(fixed / div), variable: Math.round(variable / div) };
}
