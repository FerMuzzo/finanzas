// Links the two sides of a transfer between your own accounts, so that it is not counted
// as spending on one side and income on the other.

import { daysBetween } from './dates';
import type { Transaction, VaultData } from './model';
import { uid } from './text';

const TRANSFER_TYPES = new Set(['transfer_in', 'transfer_out', 'standing_order', 'instant_transfer_out', 'other']);
const MAX_DAYS = 5;

export function linkTransfers(data: VaultData): number {
  const free = data.transactions.filter((t) => !t.transferId && !t.notTransfer && TRANSFER_TYPES.has(t.opType));
  const outs = free.filter((t) => t.amount < 0);
  const ins = free.filter((t) => t.amount > 0);
  const used = new Set<string>();
  let linked = 0;
  for (const o of outs) {
    let best: Transaction | null = null;
    let bestDays = Infinity;
    for (const i of ins) {
      if (used.has(i.id) || i.accountId === o.accountId || i.amount !== -o.amount) continue;
      const d = daysBetween(i.date, o.date);
      if (d <= MAX_DAYS && d < bestDays) {
        best = i;
        bestDays = d;
      }
    }
    if (best) {
      const id = uid();
      o.transferId = id;
      best.transferId = id;
      for (const t of [o, best]) {
        if (t.catSource !== 'user') {
          t.categoryId = 'own_transfer';
          t.catSource = 'auto';
        }
      }
      used.add(best.id);
      linked++;
    }
  }
  return linked;
}

export function unlinkTransfer(data: VaultData, transferId: string): void {
  // A side you or the app recorded by hand only existed for this transfer: it goes away
  const mirrors = new Set(data.transactions.filter((t) => t.transferId === transferId && t.mirrorOf && t.source === 'manual').map((t) => t.id));
  if (mirrors.size) data.transactions = data.transactions.filter((t) => !mirrors.has(t.id));
  for (const t of data.transactions) {
    if (t.transferId === transferId) {
      t.transferId = null;
      t.notTransfer = true; // do not link it again automatically
      if (t.categoryId === 'own_transfer') {
        t.categoryId = null;
        t.catSource = undefined;
      }
    }
  }
}
