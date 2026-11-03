// Account balances: checkpoints read from bank files or set by hand, plus the operations
// dated after them. A checkpoint is the balance at the end of its day.

import type { Account, BalanceSnapshot, VaultData } from './model';
import { formatCents } from './money';

function better(a: BalanceSnapshot, b: BalanceSnapshot): boolean {
  // Same day: a balance you set by hand wins over a bank file, and the latest one you set wins
  if (a.date !== b.date) return a.date > b.date;
  if (a.source !== b.source) return a.source === 'manual';
  return (a.setAt ?? '') > (b.setAt ?? '');
}

export function checkpoints(data: VaultData, accountId: string): BalanceSnapshot[] {
  return data.balances
    .filter((b) => b.accountId === accountId)
    .sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
}

/** Balance at the end of a day, or null when no checkpoint allows to know it. */
export function balanceAt(data: VaultData, account: Account, date: string): number | null {
  const snaps = checkpoints(data, account.id);
  const txs = data.transactions.filter((t) => t.accountId === account.id);
  const before = snaps.find((s) => s.date <= date);
  if (before) return before.amount + txs.filter((t) => t.date > before.date && t.date <= date).reduce((s, t) => s + t.amount, 0);
  const after = [...snaps].reverse().find((s) => s.date > date);
  if (after) return after.amount - txs.filter((t) => t.date > date && t.date <= after.date).reduce((s, t) => s + t.amount, 0);
  if (account.bank === 'cash') return txs.filter((t) => t.date <= date).reduce((s, t) => s + t.amount, 0);
  return null;
}

export function currentBalanceOf(data: VaultData, account: Account): number | null {
  return balanceAt(data, account, '9999-12-31');
}

/**
 * Set the balance of an account at the end of a day. Operations are not changed: the app
 * counts the operations dated after this day on top of it.
 */
export function setBalance(data: VaultData, account: Account, date: string, amount: number, reason = 'set by hand'): void {
  const before = balanceAt(data, account, date);
  data.balances = data.balances.filter((b) => !(b.accountId === account.id && b.date === date && b.source === 'manual'));
  const now = new Date().toISOString();
  data.balances.push({ accountId: account.id, date, amount, source: 'manual', setAt: now });
  data.audit.push({
    at: now,
    action: 'balance corrected',
    detail: `${account.name} on ${date}: ${before === null ? 'unknown' : formatCents(before)} to ${formatCents(amount)} (${reason})`,
  });
}

/** Remove a balance you set by hand. */
export function removeManualBalance(data: VaultData, account: Account, date: string): void {
  data.balances = data.balances.filter((b) => !(b.accountId === account.id && b.date === date && b.source === 'manual'));
  data.audit.push({ at: new Date().toISOString(), action: 'balance checkpoint removed', detail: `${account.name} on ${date}` });
}
