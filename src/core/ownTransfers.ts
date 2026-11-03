// Transfer names of an account: the names or words the bank shows on transfers to and from that
// account. A savings account reached only through the current account never has its own file,
// so each matching transfer in your other accounts is recorded in it automatically, which keeps
// its balance up to date.

import { recordInAccount } from './accounts';
import { categorizeAll } from './categorize';
import type { Account, Transaction, VaultData } from './model';
import { linkSeries } from './recurring';
import { normalizeKey } from './text';

const TRANSFER_TYPES = new Set(['transfer_in', 'transfer_out', 'standing_order', 'instant_transfer_out', 'other', 'manual']);

function words(s: string): string[] {
  return normalizeKey(s).replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 1);
}

/** Clean list of names: one per entry, empty ones and repeats removed. */
export function cleanNames(input: string | string[]): string[] {
  const list = Array.isArray(input) ? input : input.split(/[\n,;]+/);
  const out: string[] = [];
  for (const raw of list) {
    const n = raw.trim().replace(/\s+/g, ' ');
    if (words(n).length && !out.some((o) => normalizeKey(o) === normalizeKey(n))) out.push(n);
  }
  return out;
}

/** Every word of one of the names appears in the operation (name, bank text or reason), in any order. */
export function matchesNames(t: Transaction, names: string[]): boolean {
  const hay = new Set(words([t.counterparty, t.label, t.detail, t.motif ?? ''].join(' ')));
  return names.some((n) => {
    const w = words(n);
    return w.length > 0 && w.every((x) => hay.has(x));
  });
}

function namesOf(a: Account, override?: { accountId: string; names: string[] }): string[] {
  return override && override.accountId === a.id ? override.names : a.transferNames ?? [];
}

export interface Candidate {
  t: Transaction;
  target: Account;
}

export interface Matches {
  record: Candidate[]; // will be recorded in the account whose names they match
  ambiguous: Transaction[]; // match the names of more than one account: left for you to record
}

/** Operations of your other accounts that match the transfer names of an account and are not linked yet. */
export function findMatches(data: VaultData, override?: { accountId: string; names: string[] }, onlyIds?: Set<string>): Matches {
  const named = data.accounts.filter((a) => namesOf(a, override).length > 0);
  const out: Matches = { record: [], ambiguous: [] };
  if (!named.length) return out;
  for (const t of data.transactions) {
    if (onlyIds && !onlyIds.has(t.id)) continue;
    if (t.transferId || t.notTransfer || t.mirrorOf || t.amount === 0 || !TRANSFER_TYPES.has(t.opType)) continue;
    if (t.catSource === 'user' && t.categoryId !== 'own_transfer' && t.categoryId !== 'savings') continue; // you said it is something else
    const targets = named.filter((a) => a.id !== t.accountId && matchesNames(t, namesOf(a, override)));
    if (targets.length === 1) out.record.push({ t, target: targets[0] });
    else if (targets.length > 1) out.ambiguous.push(t);
  }
  return out;
}

/** Operations recorded automatically in an account that would no longer match its names. */
export function staleRecords(data: VaultData, account: Account, names: string[]): Transaction[] {
  const byId = new Map(data.transactions.map((t) => [t.id, t]));
  return data.transactions.filter((m) => {
    if (m.accountId !== account.id || !m.autoRecorded || m.source !== 'manual' || !m.mirrorOf) return false;
    const original = byId.get(m.mirrorOf);
    return !original || !matchesNames(original, names);
  });
}

/** Record every operation that matches the names of exactly one account. Returns how many were recorded. */
export function autoRecord(data: VaultData, onlyIds?: Set<string>): number {
  const { record } = findMatches(data, undefined, onlyIds);
  let n = 0;
  for (const { t, target } of record) {
    const m = recordInAccount(data, t.id, target.id);
    if (!m) continue;
    const stored = data.transactions.find((x) => x.id === m.id);
    if (stored) {
      stored.autoRecorded = true;
      stored.note = `Recorded automatically: "${t.counterparty}" matches the transfer names of ${target.name}`;
    }
    n++;
  }
  if (n) linkSeries(data);
  return n;
}

/** Save the transfer names of an account, remove what no longer matches, record what now matches. */
export function setTransferNames(data: VaultData, accountId: string, input: string | string[]): { added: number; removed: number } {
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) return { added: 0, removed: 0 };
  const names = cleanNames(input);
  const stale = staleRecords(data, account, names);
  for (const m of stale) {
    data.transactions = data.transactions.filter((x) => x.id !== m.id);
    const original = data.transactions.find((x) => x.id === m.mirrorOf);
    if (original && original.transferId === m.transferId) {
      original.transferId = null;
      if (original.catSource !== 'user') {
        original.categoryId = null;
        original.catSource = undefined;
      }
    }
  }
  if (stale.length) categorizeAll(data, (t) => t.categoryId === null);
  account.transferNames = names.length ? names : undefined;
  const added = autoRecord(data);
  data.audit.push({
    at: new Date().toISOString(),
    action: 'transfer names changed',
    detail: `${account.name}: ${names.length} name${names.length === 1 ? '' : 's'}, ${added} operation${added === 1 ? '' : 's'} recorded, ${stale.length} removed`,
  });
  return { added, removed: stale.length };
}
