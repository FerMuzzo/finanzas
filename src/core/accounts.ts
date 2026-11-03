// Accounts you add by hand (for example a savings account whose bank gives no export), and
// transfers recorded in them from an operation of another account.

import { keyOf } from './merchant';
import { nextAccountColor, type Account, type BankId, type Transaction, type VaultData } from './model';
import { linkSeries } from './recurring';
import { uid } from './text';

export interface NewAccountInput {
  name: string;
  bank: BankId;
  type: 'checking' | 'savings';
  color?: number;
  balance?: number; // cents, optional starting balance
  balanceDate?: string; // ISO, end of that day
}

export function addAccount(data: VaultData, input: NewAccountInput): Account {
  const now = new Date().toISOString();
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Give the account a name.');
  if (data.accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) throw new Error('You already have an account with this name.');
  const account: Account = {
    id: uid(),
    name,
    bank: input.bank,
    type: input.type,
    currency: 'EUR',
    color: input.color ?? nextAccountColor(data.accounts),
    createdAt: now,
  };
  data.accounts.push(account);
  if (input.balance !== undefined && input.balanceDate) {
    data.balances.push({ accountId: account.id, date: input.balanceDate, amount: input.balance, source: 'manual', setAt: now });
  }
  data.audit.push({ at: now, action: 'account added', detail: `${name}${input.balance !== undefined ? ', starting balance set' : ''}` });
  return data.accounts.find((a) => a.id === account.id) ?? account; // the stored object (the app keeps its own copy)
}

/** Operations that can be recorded in another account: not already linked to their other side. */
export function canRecordElsewhere(data: VaultData, t: Transaction): boolean {
  return !t.transferId && t.amount !== 0 && data.accounts.some((a) => a.id !== t.accountId);
}

/**
 * Record the other side of an operation in another of your accounts: money sent from your current
 * account appears as money received in the savings account, and both are linked as a transfer
 * between your accounts. The new line is marked as added by hand, so when the statement of that
 * account is imported later, the bank line is merged with it instead of being counted twice.
 */
export function recordInAccount(data: VaultData, txId: string, targetId: string): Transaction | null {
  const t = data.transactions.find((x) => x.id === txId);
  const target = data.accounts.find((a) => a.id === targetId);
  if (!t || !target || t.accountId === targetId || t.transferId) return null;
  const from = data.accounts.find((a) => a.id === t.accountId);
  const amount = -t.amount;
  const name = `${amount > 0 ? 'From' : 'To'} ${from?.name ?? 'another account'}`;
  const id = uid();
  const link = uid();
  const now = new Date().toISOString();
  const mirror: Transaction = {
    id,
    accountId: target.id,
    date: t.date,
    label: name,
    detail: '',
    amount,
    currency: t.currency,
    opType: amount > 0 ? 'transfer_in' : 'transfer_out',
    counterparty: name,
    merchantKey: keyOf('TRANSFER ' + (from?.name ?? '')),
    categoryId: 'own_transfer',
    catSource: 'auto',
    note: t.counterparty ? `Recorded from "${t.counterparty}"` : undefined,
    tags: [],
    source: 'manual',
    fp: 'manual:' + id,
    transferId: link,
    mirrorOf: t.id,
    createdAt: now,
  };
  t.transferId = link;
  t.notTransfer = undefined;
  if (t.catSource !== 'user') {
    t.categoryId = 'own_transfer';
    t.catSource = 'auto';
  }
  data.transactions.push(mirror);
  data.transactions.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  return mirror;
}

/** Record several operations in another account at once. Returns how many were recorded. */
export function recordManyInAccount(data: VaultData, txIds: string[], targetId: string): number {
  let n = 0;
  for (const id of txIds) if (recordInAccount(data, id, targetId)) n++;
  if (n) {
    linkSeries(data);
    const target = data.accounts.find((a) => a.id === targetId);
    data.audit.push({ at: new Date().toISOString(), action: 'transfers recorded', detail: `${n} in ${target?.name ?? 'an account'}` });
  }
  return n;
}
