// Flags transfers whose counterparty contains one of your own names, for example a transfer
// you send from one of your banks to the other.

import type { VaultData } from './model';
import { normalizeKey } from './text';

const TRANSFER_TYPES = new Set(['transfer_in', 'transfer_out', 'standing_order', 'instant_transfer_out']);

export function matchesOwnName(counterparty: string, holderNames: string[]): boolean {
  const words = new Set(normalizeKey(counterparty).replace(/[^a-z ]/g, ' ').split(' ').filter(Boolean));
  return holderNames.some((name) => {
    const parts = normalizeKey(name).replace(/[^a-z ]/g, ' ').split(' ').filter((w) => w.length > 1);
    return parts.length > 0 && parts.every((p) => words.has(p));
  });
}

export function applyOwnNameHints(data: VaultData): void {
  const names = data.settings.holderNames.filter((n) => n.trim());
  for (const t of data.transactions) {
    if (!TRANSFER_TYPES.has(t.opType)) continue;
    t.ownTransferHint = names.length > 0 && matchesOwnName(t.counterparty, names) ? true : undefined;
  }
}
