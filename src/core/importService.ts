// Turns a bank file into a preview (what is new, what is a duplicate, integrity checks)
// and commits it into the vault.

import { readTable } from './csv';
import { daysBetween, monthOf, todayIso } from './dates';
import { sgImporter } from './importers/sg';
import { parseSgDetail, type DetailInfo } from './importers/sgDetail';
import { hellobankImporter } from './importers/hellobank';
import { parseHellobankDetail } from './importers/hellobankDetail';
import { categorizeAll } from './categorize';
import { linkSeries } from './recurring';
import type { Importer, ParsedFile, ParsedRow } from './importers/types';
import type { Account, BankId, Transaction, VaultData } from './model';
import { BANK_NAMES, nextAccountColor } from './model';
import { linkTransfers } from './transfers';
import { applyOwnNameHints } from './ownNames';
import { decodeBytes, hash53, normalizeKey, repairMojibake, uid } from './text';

export const IMPORTERS: Importer[] = [sgImporter, hellobankImporter];

/**
 * new: not in the app yet.
 * duplicate: exactly the same bank line was already imported.
 * possible: an imported operation has the same day, amount and a similar name (skipped unless you include it).
 * manual: matches an operation you added by hand; the two are merged instead of counted twice.
 */
export type RowStatus = 'new' | 'duplicate' | 'possible' | 'manual';

export interface PreviewRow {
  row: ParsedRow;
  info: DetailInfo;
  fp: string;
  status: RowStatus;
  duplicate: boolean; // exact duplicate
  match?: Transaction; // the existing operation it matches (possible and manual)
}

export interface MonthCount {
  month: string;
  count: number;
  income: number;
  spending: number;
}

export interface ImportPreview {
  fileName: string;
  fileHash: string;
  parsed: ParsedFile;
  account: Account | null; // existing account matched, or null when a new one will be created
  proposedAccountName: string;
  idHash?: string;
  rows: PreviewRow[];
  newCount: number;
  duplicateCount: number;
  possibleCount: number;
  manualCount: number;
  months: MonthCount[];
  integrityOk: boolean | null; // null when the file does not announce a count
  alreadyImportedAt?: string;
}

export class ImportError extends Error {}

export function detailFor(bank: BankId, row: ParsedRow): DetailInfo {
  switch (bank) {
    case 'hellobank':
      return parseHellobankDetail(row.label, row.amount);
    case 'sg':
    default:
      return parseSgDetail(row.label, row.detail, row.date, row.amount);
  }
}

/** Fingerprint: same day, same amount, same text, and position among identical lines. */
export function fingerprints(rows: ParsedRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = `${r.date}|${r.amount}|${normalizeKey(r.detail || r.label)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return hash53(base + '#' + n);
  });
}

export function parseBankText(text: string): ParsedFile {
  const table = readTable(repairMojibake(text));
  const importer = IMPORTERS.find((imp) => imp.detect(table));
  if (!importer) {
    throw new ImportError(
      'This file format is not recognized. Société Générale and Hello bank CSV exports are supported.',
    );
  }
  return importer.parse(table);
}

export function previewImport(bytes: ArrayBuffer | Uint8Array, fileName: string, data: VaultData): ImportPreview {
  const text = decodeBytes(bytes);
  const parsed = parseBankText(text);
  if (parsed.rows.length === 0) throw new ImportError(parsed.errors[0] ?? 'No operations found in this file.');
  const fileHash = hash53(text, 7);

  const idHash = parsed.accountDigits ? hash53(data.salt + parsed.accountDigits, 11) : undefined;
  const account =
    data.accounts.find((a) => a.bank === parsed.bank && idHash && a.idHash === idHash) ??
    data.accounts.find((a) => a.bank === parsed.bank && parsed.last4 && a.last4 === parsed.last4) ??
    null;

  const accountTxs = account ? data.transactions.filter((t) => t.accountId === account.id) : [];
  const existing = new Set(accountTxs.map((t) => t.fp));
  const fps = fingerprints(parsed.rows);
  const manualPool = accountTxs.filter((t) => t.source === 'manual' || t.source === 'voice');
  const importedPool = accountTxs.filter((t) => t.source === 'import' || t.source === 'demo');
  const usedMatches = new Set<string>();

  const rows: PreviewRow[] = parsed.rows.map((row, i) => {
    const info = detailFor(parsed.bank, row);
    const fp = fps[i];
    if (existing.has(fp)) return { row, info, fp, status: 'duplicate', duplicate: true };
    const bankDay = info.opDate ?? row.date;
    // An operation added by hand: same amount, within a few days of the payment date
    let best: Transaction | undefined;
    let bestDays = Infinity;
    for (const t of manualPool) {
      if (usedMatches.has(t.id) || t.amount !== row.amount) continue;
      const d = Math.min(daysBetween(t.date, bankDay), daysBetween(t.date, row.date));
      if (d <= 4 && d < bestDays) {
        best = t;
        bestDays = d;
      }
    }
    if (best) {
      usedMatches.add(best.id);
      return { row, info, fp, status: 'manual', duplicate: false, match: best };
    }
    // Same day, same amount and a similar name as something already imported
    const similar = importedPool.find(
      (t) => !usedMatches.has(t.id) && t.amount === row.amount && daysBetween(t.date, row.date) <= 1 && sameName(t, info.merchantKey, row),
    );
    if (similar) {
      usedMatches.add(similar.id);
      return { row, info, fp, status: 'possible', duplicate: false, match: similar };
    }
    return { row, info, fp, status: 'new', duplicate: false };
  });

  const monthsMap = new Map<string, MonthCount>();
  for (const r of rows) {
    if (r.status !== 'new') continue;
    const m = monthOf(r.row.date);
    const mc = monthsMap.get(m) ?? { month: m, count: 0, income: 0, spending: 0 };
    mc.count++;
    if (r.row.amount >= 0) mc.income += r.row.amount;
    else mc.spending += -r.row.amount;
    monthsMap.set(m, mc);
  }

  const prior = data.imports.find((b) => b.fileHash === fileHash);
  const count = (st: RowStatus) => rows.filter((r) => r.status === st).length;
  const newCount = count('new');
  return {
    fileName,
    fileHash,
    parsed,
    account,
    proposedAccountName: account?.name ?? `${BANK_NAMES[parsed.bank]}${parsed.last4 ? ' ••' + parsed.last4 : ''}`,
    idHash,
    rows,
    newCount,
    duplicateCount: count('duplicate'),
    possibleCount: count('possible'),
    manualCount: count('manual'),
    months: [...monthsMap.values()].sort((a, b) => b.month.localeCompare(a.month)),
    integrityOk: parsed.announcedCount === undefined ? null : parsed.announcedCount === parsed.rows.length,
    alreadyImportedAt: prior?.importedAt,
  };
}

function words(s: string): Set<string> {
  return new Set(normalizeKey(s).replace(/[^a-z ]/g, ' ').split(' ').filter((w) => w.length > 1));
}

function sameName(t: Transaction, merchantKey: string, row: ParsedRow): boolean {
  if (t.merchantKey && t.merchantKey === merchantKey) return true;
  const a = words(t.detail || t.label);
  const b = words(row.detail || row.label);
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 && inter / union >= 0.6;
}

export interface CommitResult {
  accountId: string;
  added: number;
  duplicates: number;
  merged: number; // bank lines merged with operations you added by hand
  possibleSkipped: number;
  transfersLinked: number;
}

export interface CommitOptions {
  includePossible?: boolean;
  color?: number;
}

export function commitImport(preview: ImportPreview, data: VaultData, accountName?: string, opts: CommitOptions = {}): CommitResult {
  const now = new Date().toISOString();
  let account = preview.account ? data.accounts.find((a) => a.id === preview.account!.id) ?? null : null;
  if (!account) {
    account = {
      id: uid(),
      name: (accountName || preview.proposedAccountName).trim(),
      bank: preview.parsed.bank,
      type: 'checking',
      currency: preview.parsed.balance?.currency ?? 'EUR',
      last4: preview.parsed.last4,
      idHash: preview.idHash,
      color: opts.color ?? nextAccountColor(data.accounts),
      createdAt: now,
    };
    data.accounts.push(account);
  } else if (accountName && accountName.trim() && accountName.trim() !== account.name) {
    account.name = accountName.trim();
  }

  const importId = uid();
  const existing = new Set(data.transactions.filter((t) => t.accountId === account!.id).map((t) => t.fp));
  let added = 0;
  let merged = 0;
  let possibleSkipped = 0;
  for (const r of preview.rows) {
    if (existing.has(r.fp)) continue;
    if (r.status === 'possible' && !opts.includePossible) {
      possibleSkipped++;
      continue;
    }
    if (r.status === 'manual' && r.match) {
      const m = data.transactions.find((t) => t.id === r.match!.id);
      if (m) {
        mergeManual(m, r, importId);
        existing.add(r.fp);
        merged++;
        continue;
      }
    }
    existing.add(r.fp);
    const t: Transaction = {
      id: uid(),
      accountId: account.id,
      date: r.row.date,
      opDate: r.info.opDate,
      label: r.row.label,
      detail: r.row.detail,
      amount: r.row.amount,
      currency: r.row.currency,
      opType: r.info.opType,
      counterparty: r.info.counterparty,
      merchantKey: r.info.merchantKey,
      online: r.info.online,
      foreign: r.info.foreign,
      creditorId: r.info.creditorId,
      motif: r.info.motif,
      channel: r.info.channel,
      categoryId: null,
      bankCategory: [r.row.bankCategory, r.row.bankSubCategory].filter(Boolean).join(' › ') || undefined,
      place: r.info.place,
      note: r.row.comment,
      tags: [],
      source: 'import',
      importId,
      fp: r.fp,
      transferId: null,
      createdAt: now,
    };
    data.transactions.push(t);
    added++;
  }

  data.imports.push({
    id: importId,
    accountId: account.id,
    bank: preview.parsed.bank,
    fileHash: preview.fileHash,
    fileName: preview.fileName,
    periodStart: preview.parsed.periodStart,
    periodEnd: preview.parsed.periodEnd,
    rowsRead: preview.rows.length,
    announcedCount: preview.parsed.announcedCount,
    newCount: added,
    duplicateCount: preview.rows.length - added - merged,
    importedAt: now,
  });

  const bal = preview.parsed.balance;
  if (bal && bal.date) {
    const exists = data.balances.some((b) => b.accountId === account!.id && b.date === bal.date);
    if (!exists) data.balances.push({ accountId: account.id, date: bal.date, amount: bal.amount, source: 'import' });
  }

  data.transactions.sort((a, b) => b.date.localeCompare(a.date) || a.createdAt.localeCompare(b.createdAt));
  applyOwnNameHints(data);
  const transfersLinked = linkTransfers(data);
  categorizeAll(data);
  linkSeries(data);
  data.audit.push({
    at: now,
    action: 'import',
    detail: `${account.name}: ${added} new, ${merged} merged with manual entries, ${preview.rows.length - added - merged} skipped (${preview.parsed.periodStart ?? '?'} to ${preview.parsed.periodEnd ?? '?'})`,
  });
  return {
    accountId: account.id,
    added,
    duplicates: preview.rows.length - added - merged - possibleSkipped,
    merged,
    possibleSkipped,
    transfersLinked,
  };
}

/** The bank line confirms an operation you added by hand: keep your category and note, take the bank's details. */
function mergeManual(m: Transaction, r: PreviewRow, importId: string): void {
  const typed = m.counterparty;
  m.opDate = r.info.opDate ?? m.date;
  m.date = r.row.date;
  m.label = r.row.label;
  m.detail = r.row.detail;
  m.opType = r.info.opType;
  m.counterparty = r.info.counterparty;
  m.merchantKey = r.info.merchantKey;
  m.online = r.info.online;
  m.foreign = r.info.foreign;
  m.creditorId = r.info.creditorId;
  m.motif = r.info.motif;
  m.channel = r.info.channel;
  m.place = r.info.place;
  m.bankCategory = [r.row.bankCategory, r.row.bankSubCategory].filter(Boolean).join(' › ') || undefined;
  if (typed && typed !== m.counterparty && !(m.note ?? '').includes(typed)) m.note = [m.note, 'Added by hand as ' + typed].filter(Boolean).join('. ');
  m.source = 'import';
  m.importId = importId;
  m.fp = r.fp;
  m.mergedFromManual = true;
}

export function lastImportDate(data: VaultData, accountId: string): string | undefined {
  return data.imports.filter((b) => b.accountId === accountId).map((b) => b.importedAt).sort().pop();
}

export { todayIso };
