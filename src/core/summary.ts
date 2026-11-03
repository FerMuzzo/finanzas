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

/**
 * Operations that move money from an everyday account to one of your savings accounts (or back):
 * internal transfers, but they count as money set aside.
 */
export function toSavingsIds(data: VaultData): Set<string> {
  const acc = new Map(data.accounts.map((a) => [a.id, a]));
  const byTransfer = new Map<string, Transaction[]>();
  for (const t of data.transactions) if (t.transferId) byTransfer.set(t.transferId, [...(byTransfer.get(t.transferId) ?? []), t]);
  const out = new Set<string>();
  for (const pair of byTransfer.values()) {
    if (pair.length !== 2) continue;
    const [a, b] = pair;
    const sa = acc.get(a.accountId)?.type === 'savings';
    const sb = acc.get(b.accountId)?.type === 'savings';
    if (sa && !sb) out.add(b.id);
    if (sb && !sa) out.add(a.id);
  }
  return out;
}

export function monthlySummaries(data: VaultData, accountIds?: string[]): MonthSummary[] {
  const ok = accFilter(accountIds);
  const cats = catMap(data);
  const toSavings = toSavingsIds(data);
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
    else if (k === 'savings' || (k === 'internal' && toSavings.has(t.id))) s.savings += -t.amount;
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

export function topMerchants(data: VaultData, months: string[], opts: { categoryId?: string | null; limit?: number; average?: boolean; accountIds?: string[] } = {}): MerchantTotal[] {
  const set = new Set(months);
  const ok = accFilter(opts.accountIds);
  const cats = catMap(data);
  const map = new Map<string, MerchantTotal>();
  for (const t of data.transactions) {
    if (!set.has(monthOf(t.date)) || !ok(t) || kindOf(t, cats) !== 'expense') continue;
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
export function completeMonths(data: VaultData, todayIso: string, accountIds?: string[]): string[] {
  const current = todayIso.slice(0, 7);
  const ok = accFilter(accountIds);
  const months = new Set(data.transactions.filter(ok).map((t) => monthOf(t.date)));
  return [...months].filter((m) => m < current).sort().reverse();
}

/** Spending of one month split into regular payments you confirmed and everything else. */
export function fixedVersusVariable(data: VaultData, months: string[], average = false, accountIds?: string[]): { fixed: number; variable: number } {
  const set = new Set(months);
  const ok = accFilter(accountIds);
  const cats = catMap(data);
  let fixed = 0;
  let variable = 0;
  for (const t of data.transactions) {
    if (!set.has(monthOf(t.date)) || !ok(t) || kindOf(t, cats) !== 'expense') continue;
    if (t.recurringId) fixed += -t.amount;
    else variable += -t.amount;
  }
  const div = average && months.length ? months.length : 1;
  return { fixed: Math.round(fixed / div), variable: Math.round(variable / div) };
}

export interface TransferFlow {
  key: string;
  fromId: string | null; // null: an account that is not in the app
  toId: string | null;
  otherName?: string; // name of the other side when it is not in the app
  amount: number; // positive cents moved (per month with average)
  count: number;
}

/**
 * Money moved between your own accounts, grouped by direction (from one account to another).
 * Each transfer is counted once, on the side the money left. Operations categorized as a
 * transfer between your accounts whose other side is not in the app are listed too.
 */
export function transferFlows(data: VaultData, months: string[], opts: { accountIds?: string[]; average?: boolean } = {}): { flows: TransferFlow[]; total: number } {
  const set = new Set(months);
  const want = opts.accountIds && opts.accountIds.length ? new Set(opts.accountIds) : null;
  const cash = data.accounts.find((a) => a.bank === 'cash');
  const byLink = new Map<string, Transaction[]>();
  for (const t of data.transactions) if (t.transferId) byLink.set(t.transferId, [...(byLink.get(t.transferId) ?? []), t]);
  const map = new Map<string, TransferFlow>();
  const add = (date: string, fromId: string | null, toId: string | null, amount: number, otherName?: string) => {
    if (!set.has(monthOf(date))) return;
    if (want && !(fromId && want.has(fromId)) && !(toId && want.has(toId))) return;
    const key = `${fromId ?? 'x:' + otherName}>${toId ?? 'x:' + otherName}`;
    const f = map.get(key) ?? { key, fromId, toId, otherName, amount: 0, count: 0 };
    f.amount += amount;
    f.count++;
    map.set(key, f);
  };
  for (const t of data.transactions) {
    if (t.transferId) {
      const pair = byLink.get(t.transferId) ?? [];
      const other = pair.find((o) => o.id !== t.id);
      if (t.amount < 0) add(t.date, t.accountId, other?.accountId ?? null, -t.amount, other ? undefined : t.counterparty);
      else if (!other) add(t.date, null, t.accountId, t.amount, t.counterparty);
      continue;
    }
    if (t.categoryId !== 'own_transfer') continue;
    if (t.opType === 'cash_withdrawal' && cash) {
      add(t.date, t.accountId, cash.id, -t.amount);
      continue;
    }
    if (t.amount < 0) add(t.date, t.accountId, null, -t.amount, t.counterparty);
    else add(t.date, null, t.accountId, t.amount, t.counterparty);
  }
  const div = opts.average && months.length ? months.length : 1;
  const flows = [...map.values()]
    .map((f) => ({ ...f, amount: Math.round(f.amount / div), count: f.count / div }))
    .sort((a, b) => b.amount - a.amount);
  return { flows, total: flows.reduce((s, f) => s + f.amount, 0) };
}
