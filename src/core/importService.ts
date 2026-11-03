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
import type { ParsedPdf } from './pdfStatement';
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
  include: boolean; // will be imported (possible duplicates are added only if you include them)
  amount: number; // amount to import: the direction can be corrected when reviewing a PDF statement
  part: number; // index of the file it comes from
}

export interface MonthCount {
  month: string;
  count: number;
  income: number;
  spending: number;
}

export interface FilePart {
  fileName: string;
  fileHash: string;
  parsed: ParsedFile;
  pdf?: ParsedPdf;
  alreadyImportedAt?: string;
}

export interface ImportPreview {
  format: 'csv' | 'pdf';
  fileName: string;
  fileHash: string;
  parsed: ParsedFile; // for several PDF statements: their operations together
  parts: FilePart[];
  account: Account | null; // existing account matched or chosen, or null when a new one will be created
  autoMatched: boolean; // the account was recognized from the file
  suggested?: boolean; // the only savings account without statements was chosen for you
  proposedAccountName: string;
  proposedType: 'checking' | 'savings';
  idHash?: string;
  pdfKey?: string;
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
      return parseSgDetail(row.label, row.detail, row.date, row.amount);
    default: {
      // Unknown bank: the first reader that recognizes the operation type
      const sg = parseSgDetail(row.label, row.detail, row.date, row.amount);
      const hb = parseHellobankDetail(row.detail || row.label, row.amount);
      const generic = (i: DetailInfo) => i.opType === 'other' || /^(Transfer received|Transfer sent|Direct debit)$/.test(i.counterparty);
      if (!generic(sg)) return sg;
      if (!generic(hb)) return hb;
      return sg.opType !== 'other' ? sg : hb.opType !== 'other' ? hb : sg;
    }
  }
}

const OUT_TYPES = new Set(['transfer_out', 'standing_order', 'instant_transfer_out']);

/** Keep the operation type consistent with the direction of the money (statements state it by column). */
function alignWithSign(info: DetailInfo, amount: number): DetailInfo {
  if (amount > 0 && OUT_TYPES.has(info.opType)) return { ...info, opType: 'transfer_in' };
  if (amount < 0 && info.opType === 'transfer_in') return { ...info, opType: 'transfer_out' };
  if (amount < 0 && info.opType === 'interest') return { ...info, opType: 'bank_fee' };
  return info;
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
      'This file format is not recognized. Société Générale and Hello bank CSV exports, and PDF statements, are supported.',
    );
  }
  return importer.parse(table);
}

interface Candidate {
  row: ParsedRow;
  info: DetailInfo;
  fp: string;
  part: number;
}

/** Compare the operations of a file with the ones already in the account. */
function classify(cands: Candidate[], account: Account | null, data: VaultData): PreviewRow[] {
  const accountTxs = account ? data.transactions.filter((t) => t.accountId === account.id) : [];
  const existing = new Set(accountTxs.map((t) => t.fp));
  const manualPool = accountTxs.filter((t) => t.source === 'manual' || t.source === 'voice');
  const importedPool = accountTxs.filter((t) => t.source === 'import' || t.source === 'demo');
  const usedMatches = new Set<string>();
  const inThisImport = new Set<string>();

  return cands.map(({ row, info, fp, part }) => {
    const base = { row, info, fp, part, amount: row.amount };
    if (existing.has(fp) || inThisImport.has(fp)) return { ...base, status: 'duplicate' as const, duplicate: true, include: false };
    inThisImport.add(fp);
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
      return { ...base, status: 'manual' as const, duplicate: false, match: best, include: true };
    }
    // Same day, same amount and a similar name as something already imported
    const similar = importedPool.find(
      (t) => !usedMatches.has(t.id) && t.amount === row.amount && daysBetween(t.date, row.date) <= 1 && sameName(t, info.merchantKey, row),
    );
    if (similar) {
      usedMatches.add(similar.id);
      return { ...base, status: 'possible' as const, duplicate: false, match: similar, include: false };
    }
    return { ...base, status: 'new' as const, duplicate: false, include: true };
  });
}

function summarize(rows: PreviewRow[]): Pick<ImportPreview, 'newCount' | 'duplicateCount' | 'possibleCount' | 'manualCount' | 'months'> {
  const monthsMap = new Map<string, MonthCount>();
  for (const r of rows) {
    if (r.status !== 'new') continue;
    const m = monthOf(r.row.date);
    const mc = monthsMap.get(m) ?? { month: m, count: 0, income: 0, spending: 0 };
    mc.count++;
    if (r.amount >= 0) mc.income += r.amount;
    else mc.spending += -r.amount;
    monthsMap.set(m, mc);
  }
  const count = (st: RowStatus) => rows.filter((r) => r.status === st).length;
  return {
    newCount: count('new'),
    duplicateCount: count('duplicate'),
    possibleCount: count('possible'),
    manualCount: count('manual'),
    months: [...monthsMap.values()].sort((a, b) => b.month.localeCompare(a.month)),
  };
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

  const fps = fingerprints(parsed.rows);
  const rows = classify(
    parsed.rows.map((row, i) => ({ row, info: detailFor(parsed.bank, row), fp: fps[i], part: 0 })),
    account,
    data,
  );
  const prior = data.imports.find((b) => b.fileHash === fileHash);
  return {
    format: 'csv',
    fileName,
    fileHash,
    parsed,
    parts: [{ fileName, fileHash, parsed, alreadyImportedAt: prior?.importedAt }],
    account,
    autoMatched: !!account,
    proposedAccountName: account?.name ?? `${BANK_NAMES[parsed.bank]}${parsed.last4 ? ' ••' + parsed.last4 : ''}`,
    proposedType: 'checking',
    idHash,
    rows,
    ...summarize(rows),
    integrityOk: parsed.announcedCount === undefined ? null : parsed.announcedCount === parsed.rows.length,
    alreadyImportedAt: prior?.importedAt,
  };
}

export interface PdfInput {
  fileName: string;
  fileHash: string;
  parsed: ParsedPdf;
}

/**
 * Preview of one or several PDF statements of the same account. accountId: undefined to
 * recognize the account, null for a new account, or the id of the account you chose.
 */
export function previewPdf(inputs: PdfInput[], data: VaultData, accountId?: string | null): ImportPreview {
  const usable = inputs.filter((i) => i.parsed.rows.length > 0);
  if (!usable.length) throw new ImportError(inputs[0]?.parsed.errors[0] ?? 'No operations found in these files.');
  const first = usable[0].parsed;
  const ibanDigits = usable.find((i) => i.parsed.ibanDigits)?.parsed.ibanDigits;
  const pdfKey = ibanDigits ? hash53(data.salt + 'pdf:' + ibanDigits, 13) : undefined;
  const last4 = usable.find((i) => i.parsed.last4)?.parsed.last4;

  const ibans = new Set(usable.map((i) => i.parsed.ibanDigits).filter(Boolean));
  let account: Account | null = null;
  let autoMatched = false;
  let suggested = false;
  if (accountId === undefined) {
    account =
      (pdfKey && data.accounts.find((a) => a.pdfKey === pdfKey)) ||
      (first.bank !== 'other' && last4 && data.accounts.find((a) => a.bank === first.bank && a.last4 === last4)) ||
      null;
    autoMatched = !!account;
    if (!account && !pdfKey && data.settings.lastPdfAccountId) account = data.accounts.find((a) => a.id === data.settings.lastPdfAccountId) ?? null;
    if (!account && first.proposedType === 'savings') {
      // A savings account you added by hand, with no statement yet, is the likely one
      const free = data.accounts.filter((a) => a.type === 'savings' && !a.pdfKey && !a.idHash && !data.imports.some((b) => b.accountId === a.id));
      if (free.length === 1) {
        account = free[0];
        suggested = true;
      }
    }
  } else if (accountId) {
    account = data.accounts.find((a) => a.id === accountId) ?? null;
  }

  // Oldest statement first, so the operations read in date order
  const ordered = [...usable].sort((a, b) => (a.parsed.periodStart ?? '').localeCompare(b.parsed.periodStart ?? ''));
  const cands: Candidate[] = [];
  ordered.forEach((input, part) => {
    const fps = fingerprints(input.parsed.rows);
    input.parsed.rows.forEach((row, i) => {
      cands.push({ row, info: alignWithSign(detailFor(input.parsed.bank, row), row.amount), fp: fps[i], part });
    });
  });
  const rows = classify(cands, account, data);
  const parts: FilePart[] = ordered.map((i) => ({
    fileName: i.fileName,
    fileHash: i.fileHash,
    parsed: i.parsed,
    pdf: i.parsed,
    alreadyImportedAt: data.imports.find((b) => b.fileHash === i.fileHash)?.importedAt,
  }));

  const periods = ordered.flatMap((i) => [i.parsed.periodStart, i.parsed.periodEnd]).filter(Boolean) as string[];
  const lastWithBalance = [...ordered].reverse().find((i) => i.parsed.balance);
  const many = ordered.length > 1;
  const combined: ParsedFile = {
    bank: first.bank,
    bankName: first.bankName,
    last4,
    accountLabel: first.accountLabel,
    periodStart: periods.length ? periods.reduce((a, b) => (a < b ? a : b)) : undefined,
    periodEnd: periods.length ? periods.reduce((a, b) => (a > b ? a : b)) : undefined,
    balance: lastWithBalance?.parsed.balance,
    rows: ordered.flatMap((i) => i.parsed.rows),
    warnings: [
      ...(ibans.size > 1 ? ['These statements show different account numbers. Import the statements of each account separately.'] : []),
      ...ordered.flatMap((i) => i.parsed.warnings.map((w) => (many ? `${i.fileName}: ${w}` : w))),
    ],
    errors: inputs.flatMap((i) => i.parsed.errors.map((e) => (inputs.length > 1 ? `${i.fileName}: ${e}` : e))),
  };

  const baseName = first.proposedName !== 'Account' ? first.proposedName : first.bank !== 'other' ? BANK_NAMES[first.bank] : 'Account';
  return {
    format: 'pdf',
    fileName: many ? `${ordered.length} statements` : ordered[0].fileName,
    fileHash: ordered[0].fileHash,
    parsed: combined,
    parts,
    account,
    autoMatched,
    suggested,
    proposedAccountName: account?.name ?? `${baseName}${last4 ? ' ••' + last4 : ''}`,
    proposedType: first.proposedType,
    pdfKey,
    rows,
    ...summarize(rows),
    integrityOk: null,
    alreadyImportedAt: parts.every((p) => p.alreadyImportedAt) ? parts[0].alreadyImportedAt : undefined,
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
  excluded: number; // lines you chose to leave out
  transfersLinked: number;
}

export interface CommitOptions {
  includePossible?: boolean;
  color?: number;
  type?: 'checking' | 'savings';
}

export function commitImport(preview: ImportPreview, data: VaultData, accountName?: string, opts: CommitOptions = {}): CommitResult {
  const now = new Date().toISOString();
  let account = preview.account ? data.accounts.find((a) => a.id === preview.account!.id) ?? null : null;
  if (!account) {
    account = {
      id: uid(),
      name: (accountName || preview.proposedAccountName).trim(),
      bank: preview.parsed.bank,
      type: opts.type ?? preview.proposedType ?? 'checking',
      currency: preview.parsed.balance?.currency ?? 'EUR',
      last4: preview.parsed.last4,
      idHash: preview.idHash,
      color: opts.color ?? nextAccountColor(data.accounts),
      createdAt: now,
    };
    data.accounts.push(account);
    // Work on the stored object: the app's reactive state keeps its own copy of what is pushed
    account = data.accounts[data.accounts.length - 1];
  } else if (accountName && accountName.trim() && accountName.trim() !== account.name) {
    account.name = accountName.trim();
  }
  if (preview.pdfKey && !account.pdfKey && !data.accounts.some((a) => a.pdfKey === preview.pdfKey)) account.pdfKey = preview.pdfKey;
  if (preview.format === 'pdf') data.settings.lastPdfAccountId = account.id;

  const existing = new Set(data.transactions.filter((t) => t.accountId === account!.id).map((t) => t.fp));
  const importIds = preview.parts.map(() => uid());
  const perPart = preview.parts.map(() => ({ added: 0, merged: 0 }));
  let added = 0;
  let merged = 0;
  let possibleSkipped = 0;
  let excluded = 0;
  for (const r of preview.rows) {
    if (existing.has(r.fp)) continue;
    if (r.status === 'possible' && !(opts.includePossible || r.include)) {
      possibleSkipped++;
      continue;
    }
    if (r.status !== 'possible' && !r.include) {
      if (r.status !== 'duplicate') excluded++;
      continue;
    }
    const importId = importIds[r.part] ?? importIds[0];
    const amount = r.amount;
    const info = amount === r.row.amount ? r.info : alignWithSign(detailFor(preview.parsed.bank, { ...r.row, amount }), amount);
    if (r.status === 'manual' && r.match && amount === r.row.amount) {
      const m = data.transactions.find((t) => t.id === r.match!.id);
      if (m) {
        mergeManual(m, r, importId);
        existing.add(r.fp);
        merged++;
        perPart[r.part].merged++;
        continue;
      }
    }
    existing.add(r.fp);
    const t: Transaction = {
      id: uid(),
      accountId: account.id,
      date: r.row.date,
      opDate: info.opDate,
      label: r.row.label,
      detail: r.row.detail,
      amount,
      currency: r.row.currency,
      opType: info.opType,
      counterparty: info.counterparty,
      merchantKey: info.merchantKey,
      online: info.online,
      foreign: info.foreign,
      creditorId: info.creditorId,
      motif: info.motif,
      channel: info.channel,
      categoryId: null,
      bankCategory: [r.row.bankCategory, r.row.bankSubCategory].filter(Boolean).join(' › ') || undefined,
      place: info.place,
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
    perPart[r.part].added++;
  }

  preview.parts.forEach((part, i) => {
    const total = preview.rows.filter((r) => r.part === i).length;
    data.imports.push({
      id: importIds[i],
      accountId: account!.id,
      bank: part.parsed.bank,
      fileHash: part.fileHash,
      fileName: part.fileName,
      periodStart: part.parsed.periodStart,
      periodEnd: part.parsed.periodEnd,
      rowsRead: total,
      announcedCount: part.parsed.announcedCount,
      newCount: perPart[i].added,
      duplicateCount: total - perPart[i].added - perPart[i].merged,
      importedAt: now,
    });
    const bal = part.parsed.balance;
    if (bal && bal.date) {
      const exists = data.balances.some((b) => b.accountId === account!.id && b.date === bal.date && b.source === 'import');
      if (!exists) data.balances.push({ accountId: account!.id, date: bal.date, amount: bal.amount, source: 'import' });
    }
  });

  data.transactions.sort((a, b) => b.date.localeCompare(a.date) || a.createdAt.localeCompare(b.createdAt));
  applyOwnNameHints(data);
  const transfersLinked = linkTransfers(data);
  categorizeAll(data);
  linkSeries(data);
  const skipped = preview.rows.length - added - merged;
  data.audit.push({
    at: now,
    action: 'import',
    detail: `${account.name}${preview.format === 'pdf' ? ` (${preview.parts.length} PDF statement${preview.parts.length > 1 ? 's' : ''})` : ''}: ${added} new, ${merged} merged with manual entries, ${skipped} skipped (${preview.parsed.periodStart ?? '?'} to ${preview.parsed.periodEnd ?? '?'})`,
  });
  return {
    accountId: account.id,
    added,
    duplicates: skipped - possibleSkipped - excluded,
    merged,
    possibleSkipped,
    excluded,
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
