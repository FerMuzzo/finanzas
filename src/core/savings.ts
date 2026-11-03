// Savings simulation: balance growth with regular deposits and interest.
// French regulated savings (Livret A, LDDS, LEP) compute interest by fortnight and add it once a
// year on 31 December; the "yearly" mode approximates this by accruing monthly and adding the
// interest at the end of each 12 month period. The "monthly" mode adds it every month.

import { daysBetween, monthOf } from './dates';
import type { Account, VaultData } from './model';
import { isInternal, latestBalance } from './summary';

export interface SavingsInput {
  start: number; // cents
  monthly: number; // cents deposited at the start of each month
  ratePct: number; // yearly rate in percent
  years: number;
  interestPaid: 'yearly' | 'monthly';
  taxPct: number; // tax taken from interest, 0 for tax free accounts
}

export interface SavingsPoint {
  month: number; // 0 is today
  balance: number;
  deposited: number; // total deposited so far, including the start
  interest: number; // total net interest credited so far
}

export function simulateSavings(s: SavingsInput): { points: SavingsPoint[]; final: SavingsPoint } {
  const months = Math.max(1, Math.round(s.years * 12));
  const r = s.ratePct / 100 / 12;
  const keep = 1 - s.taxPct / 100;
  let balance = s.start;
  let deposited = s.start;
  let interest = 0;
  let pending = 0;
  const points: SavingsPoint[] = [{ month: 0, balance, deposited, interest }];
  for (let m = 1; m <= months; m++) {
    balance += s.monthly;
    deposited += s.monthly;
    const earned = balance * r * keep;
    if (s.interestPaid === 'monthly') {
      balance += earned;
      interest += earned;
    } else {
      pending += earned;
      if (m % 12 === 0) {
        balance += pending;
        interest += pending;
        pending = 0;
      }
    }
    points.push({ month: m, balance: Math.round(balance), deposited: Math.round(deposited), interest: Math.round(interest) });
  }
  return { points, final: points[points.length - 1] };
}

/** Average money moved into an account per month (deposits minus withdrawals) over its recent full months. */
export function averageMonthlyNetFlow(data: VaultData, accountId: string, months = 6): number {
  const txs = data.transactions.filter((t) => t.accountId === accountId);
  if (!txs.length) return 0;
  const byMonth = new Map<string, number>();
  for (const t of txs) byMonth.set(monthOf(t.date), (byMonth.get(monthOf(t.date)) ?? 0) + t.amount);
  const last = [...byMonth.keys()].sort().slice(-months);
  if (!last.length) return 0;
  return Math.round(last.reduce((s, m) => s + (byMonth.get(m) ?? 0), 0) / last.length);
}

/** Current balance: the latest bank balance plus operations dated after it (for example added by hand). */
export function currentBalance(data: VaultData, account: Account): number | null {
  const snap = latestBalance(data, account.id);
  const after = data.transactions.filter((t) => t.accountId === account.id && (!snap || t.date > snap.date));
  if (!snap && account.bank !== 'cash') return null;
  return (snap?.amount ?? 0) + after.reduce((s, t) => s + t.amount, 0);
}

/** Interest received last year on this account, when the bank line says so. */
export function interestSeen(data: VaultData, accountId: string): number {
  return data.transactions
    .filter((t) => t.accountId === accountId && t.amount > 0 && !isInternal(t) && /INTERET|INTERETS|INT CREDITEURS/i.test(t.detail + ' ' + t.label))
    .filter((t) => daysBetween(t.date, new Date().toISOString().slice(0, 10)) <= 400)
    .reduce((s, t) => s + t.amount, 0);
}
