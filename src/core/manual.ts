// Operations added by hand, and the check for ones that are already in the app.

import { daysBetween } from './dates';
import { categorizeAll, suggestCategory } from './categorize';
import { keyOf } from './merchant';
import { nextAccountColor, type Account, type Transaction, type VaultData } from './model';
import { linkSeries } from './recurring';
import { uid } from './text';

export interface ManualInput {
  accountId: string;
  date: string; // ISO
  amount: number; // signed cents, negative for an expense
  description: string;
  categoryId: string | null;
  note?: string;
}

/**
 * Operations that may be the same as the one being added: same account, same amount,
 * within 3 days (a card payment is often booked one or two days after the purchase).
 */
export function findSimilar(data: VaultData, input: Pick<ManualInput, 'accountId' | 'date' | 'amount'>): Transaction[] {
  return data.transactions
    .filter((t) => t.accountId === input.accountId && t.amount === input.amount)
    .filter((t) => Math.min(daysBetween(t.date, input.date), daysBetween(t.opDate ?? t.date, input.date)) <= 3)
    .sort((a, b) => daysBetween(a.opDate ?? a.date, input.date) - daysBetween(b.opDate ?? b.date, input.date));
}

export function ensureCashAccount(data: VaultData): Account {
  let cash = data.accounts.find((a) => a.bank === 'cash');
  if (!cash) {
    cash = {
      id: uid(),
      name: 'Cash',
      bank: 'cash',
      type: 'cash',
      currency: 'EUR',
      color: nextAccountColor(data.accounts),
      createdAt: new Date().toISOString(),
    };
    data.accounts.push(cash);
    categorizeAll(data); // withdrawals now move money to the Cash account
  }
  return cash;
}

function tidy(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

export function addManual(data: VaultData, input: ManualInput): Transaction {
  const id = uid();
  const name = tidy(input.description) || (input.amount < 0 ? 'Expense' : 'Income');
  const t: Transaction = {
    id,
    accountId: input.accountId,
    date: input.date,
    label: name,
    detail: '',
    amount: input.amount,
    currency: 'EUR',
    opType: 'manual',
    counterparty: name,
    merchantKey: keyOf(name),
    categoryId: input.categoryId,
    catSource: input.categoryId ? 'user' : undefined,
    note: input.note?.trim() || undefined,
    tags: [],
    source: 'manual',
    fp: 'manual:' + id,
    transferId: null,
    createdAt: new Date().toISOString(),
  };
  if (!t.categoryId) {
    const s = suggestCategory(t, data);
    t.categoryId = s.categoryId;
    t.catSource = s.source ?? undefined;
  } else if (t.merchantKey) {
    data.merchantMemory[t.merchantKey] = t.categoryId;
  }
  data.transactions.push(t);
  data.transactions.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  data.settings.lastManualAccountId = input.accountId;
  linkSeries(data);
  data.audit.push({ at: t.createdAt, action: 'manual entry' });
  return t;
}

export function deleteManual(data: VaultData, id: string): void {
  data.transactions = data.transactions.filter((t) => !(t.id === id && t.source === 'manual'));
}
