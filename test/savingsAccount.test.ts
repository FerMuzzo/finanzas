// Savings account without an export: PDF statements, accounts added by hand, transfers recorded
// in them, and balances set by hand. Invented data only.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readPdfPages } from '../src/core/pdfRead';
import { parsePdfStatement, type ParsedPdf } from '../src/core/pdfStatement';
import { commitImport, previewImport, previewPdf } from '../src/core/importService';
import { emptyVault, migrateVault, type VaultData } from '../src/core/model';
import { addAccount, recordInAccount, recordManyInAccount } from '../src/core/accounts';
import { addManual, deleteManual } from '../src/core/manual';
import { balanceAt, currentBalanceOf, setBalance } from '../src/core/balances';
import { monthlySummaries, transferFlows } from '../src/core/summary';
import { sgRawBytes } from './fixtures';

const cache = new Map<string, ParsedPdf>();
async function pdf(name: string): Promise<{ fileName: string; fileHash: string; parsed: ParsedPdf }> {
  if (!cache.has(name)) {
    const pages = await readPdfPages(pdfjs as never, new Uint8Array(readFileSync(join(__dirname, 'pdf', name))));
    cache.set(name, parsePdfStatement(pages));
  }
  // a fresh copy, as the app parses each file it is given
  return { fileName: name, fileHash: 'h-' + name, parsed: structuredClone(cache.get(name)!) };
}

function vault(): VaultData {
  return migrateVault(emptyVault());
}

describe('PDF statements import', () => {
  it('creates a savings account from statements and keeps their closing balances', async () => {
    const v = vault();
    const prev = previewPdf([await pdf('statement_sg_like.pdf'), await pdf('statement_hb_like.pdf')], v);
    expect(prev.format).toBe('pdf');
    expect(prev.account).toBeNull();
    expect(prev.parts.map((p) => p.fileName)).toEqual(['statement_hb_like.pdf', 'statement_sg_like.pdf']); // oldest first
    expect(prev.newCount).toBe(10);
    expect(prev.proposedType).toBe('savings');
    const r = commitImport(prev, v, 'My livret');
    expect(r.added).toBe(10);
    const acc = v.accounts[0];
    expect(acc).toMatchObject({ name: 'My livret', type: 'savings' });
    expect(acc.pdfKey).toBeTruthy();
    expect(v.imports.length).toBe(2);
    expect(v.balances.map((b) => [b.date, b.amount]).sort()).toEqual([
      ['2026-01-14', 216137],
      ['2026-03-31', 513550],
    ]);
    expect(currentBalanceOf(v, acc)).toBe(513550);
    const interest = v.transactions.find((t) => t.label.startsWith('INTERETS'))!;
    expect(interest).toMatchObject({ opType: 'interest', categoryId: 'interest', amount: 6137 });
    // A credit labelled as a standing order is money received on this account
    expect(v.transactions.find((t) => t.date === '2026-03-05')!.opType).toBe('transfer_in');
  });

  it('recognizes the account next month and skips statements already imported', async () => {
    const v = vault();
    commitImport(previewPdf([await pdf('statement_sg_like.pdf')], v), v);
    const again = previewPdf([await pdf('statement_sg_like.pdf')], v);
    expect(again.account?.id).toBe(v.accounts[0].id);
    expect(again.autoMatched).toBe(true);
    expect(again.newCount).toBe(0);
    expect(again.duplicateCount).toBe(6);
    expect(again.alreadyImportedAt).toBeTruthy();
  });

  it('imports into an account you choose and applies the directions you corrected', async () => {
    const v = vault();
    const acc = addAccount(v, { name: 'Savings', bank: 'other', type: 'savings' });
    const prev = previewPdf([await pdf('statement_signed.pdf')], v, acc.id);
    expect(prev.account?.id).toBe(acc.id);
    prev.rows[0].amount = -prev.rows[0].amount; // you flip one
    prev.rows[3].include = false; // and leave one out
    const r = commitImport(prev, v);
    expect(r).toMatchObject({ added: 3, excluded: 1 });
    expect(v.transactions.map((t) => t.amount).sort((a, b) => a - b)).toEqual([-25000, -10000, -10000]);
    // the two identical lines of the same day are both kept
    expect(v.transactions.filter((t) => t.amount === -10000).length).toBe(2);
  });

  it('records transfers in a savings account by hand, then merges them with its statement', async () => {
    const v = vault();
    commitImport(previewImport(sgRawBytes(), 'sg.csv', v), v);
    const checking = v.accounts[0];
    const savings = addAccount(v, { name: 'Livret', bank: 'other', type: 'savings' });
    // money sent from the current account on the day the savings statement shows it arriving
    const sent = addManual(v, { accountId: checking.id, date: '2026-03-02', amount: -20000, description: 'To my livret', categoryId: null });
    const other = addManual(v, { accountId: checking.id, date: '2026-03-20', amount: -7550, description: 'To my livret', categoryId: null });
    expect(recordManyInAccount(v, [sent.id, other.id], savings.id)).toBe(2);
    const mirror = v.transactions.find((t) => t.mirrorOf === sent.id)!;
    expect(mirror).toMatchObject({ accountId: savings.id, amount: 20000, source: 'manual', categoryId: 'own_transfer' });
    expect(mirror.transferId).toBe(sent.transferId);
    expect(recordInAccount(v, sent.id, savings.id)).toBeNull(); // already linked

    // Money moved to a savings account counts as saved, not as spent
    const march = monthlySummaries(v).find((m) => m.month === '2026-03')!;
    expect(march.savings).toBe(27550);
    expect(march.spending).toBe(0);

    const prev = previewPdf([await pdf('statement_sg_like.pdf')], v, savings.id);
    expect(prev.manualCount).toBe(2);
    commitImport(prev, v);
    const merged = v.transactions.find((t) => t.id === mirror.id)!;
    expect(merged).toMatchObject({ source: 'import', mergedFromManual: true, label: 'VIR RECU 9990001' });
    expect(merged.transferId).toBe(sent.transferId);
    expect(v.transactions.filter((t) => t.accountId === savings.id).length).toBe(6);
  });

  it('unlinks the other side when a recorded transfer is deleted', () => {
    const v = vault();
    const a = addAccount(v, { name: 'Current', bank: 'other', type: 'checking' });
    const s = addAccount(v, { name: 'Livret', bank: 'other', type: 'savings' });
    const t = addManual(v, { accountId: a.id, date: '2026-05-02', amount: -5000, description: 'Savings', categoryId: null });
    const m = recordInAccount(v, t.id, s.id)!;
    deleteManual(v, m.id);
    expect(v.transactions.find((x) => x.id === t.id)!.transferId).toBeNull();
    expect(v.transactions.find((x) => x.id === t.id)!.categoryId).not.toBe('own_transfer');
  });
});

describe('balances', () => {
  it('starts from the balance you give and adds later operations', () => {
    const v = vault();
    const s = addAccount(v, { name: 'Livret', bank: 'other', type: 'savings', balance: 100000, balanceDate: '2026-01-31' });
    addManual(v, { accountId: s.id, date: '2026-02-10', amount: 5000, description: 'Deposit', categoryId: null });
    addManual(v, { accountId: s.id, date: '2026-01-10', amount: 7000, description: 'Older deposit', categoryId: null });
    expect(currentBalanceOf(v, s)).toBe(105000);
    expect(balanceAt(v, s, '2026-01-31')).toBe(100000);
    expect(balanceAt(v, s, '2026-01-05')).toBe(93000); // worked back from the checkpoint
  });

  it('sets a balance by hand: newer than the bank, wins on the same day, and is logged', () => {
    const v = vault();
    const s = addAccount(v, { name: 'Livret', bank: 'other', type: 'savings' });
    expect(currentBalanceOf(v, s)).toBeNull();
    v.balances.push({ accountId: s.id, date: '2026-03-31', amount: 500000, source: 'import' });
    setBalance(v, s, '2026-03-31', 510000);
    expect(currentBalanceOf(v, s)).toBe(510000);
    addManual(v, { accountId: s.id, date: '2026-04-02', amount: 1000, description: 'Deposit', categoryId: null });
    expect(currentBalanceOf(v, s)).toBe(511000);
    setBalance(v, s, '2026-04-30', 600000);
    expect(currentBalanceOf(v, s)).toBe(600000);
    expect(v.audit.filter((a) => a.action === 'balance corrected').map((a) => a.detail)).toEqual([
      expect.stringMatching(/to 5.100,00/),
      expect.stringMatching(/to 6.000,00/),
    ]);
  });
});

describe('reading savings statement lines', () => {
  it('names transfers and withdrawals to another account, and suggests your savings account', async () => {
    const v = vault();
    const s = addAccount(v, { name: 'My livret', bank: 'other', type: 'savings' });
    const prev = previewPdf([await pdf('statement_hb_like.pdf')], v);
    expect(prev.account?.id).toBe(s.id);
    expect(prev.suggested).toBe(true);
    expect(prev.rows.map((r) => [r.info.opType, r.info.counterparty])).toEqual([
      ['transfer_in', 'Test Person'],
      ['interest', 'Interest'],
      ['transfer_out', 'Test Person'],
      ['transfer_in', 'Test Person'],
    ]);
    const sg = previewPdf([await pdf('statement_sg_like.pdf')], v, null);
    const w = sg.rows.find((r) => r.row.label.startsWith('RETRAIT'))!;
    expect(w.info).toMatchObject({ opType: 'transfer_out', counterparty: 'Withdrawal to Compte Courant' });
  });

  it('warns when statements of different accounts are chosen together', async () => {
    const v = vault();
    const prev = previewPdf([await pdf('statement_hb_like.pdf'), await pdf('statement_sg_like.pdf')], v);
    expect(prev.parsed.warnings[0]).toContain('different account numbers');
  });
});

describe('monthly statements of one account', () => {
  it('imports two months together, then recognizes the account and the balance of each month', async () => {
    const v = vault();
    const prev = previewPdf([await pdf('statement_sg_like_april.pdf'), await pdf('statement_sg_like.pdf')], v);
    expect(prev.parsed.warnings).toEqual([]);
    expect(prev.parts.map((p) => p.fileName)).toEqual(['statement_sg_like.pdf', 'statement_sg_like_april.pdf']);
    commitImport(prev, v);
    const acc = v.accounts[0];
    expect(currentBalanceOf(v, acc)).toBe(503550);
    expect(balanceAt(v, acc, '2026-03-31')).toBe(513550);
    const again = previewPdf([await pdf('statement_sg_like.pdf')], v);
    expect(again.account?.id).toBe(acc.id);
    expect(again.newCount).toBe(0);
  });
});

describe('transfers between your accounts', () => {
  it('groups them by direction, once per transfer, with the account filter', () => {
    const v = vault();
    const cur = addAccount(v, { name: 'Current', bank: 'other', type: 'checking' });
    const sav = addAccount(v, { name: 'Livret', bank: 'other', type: 'savings' });
    const other = addAccount(v, { name: 'Joint', bank: 'other', type: 'checking' });
    const a = addManual(v, { accountId: cur.id, date: '2026-05-02', amount: -20000, description: 'To livret', categoryId: null });
    const b = addManual(v, { accountId: cur.id, date: '2026-05-20', amount: -5000, description: 'To livret', categoryId: null });
    const back = addManual(v, { accountId: sav.id, date: '2026-05-25', amount: -3000, description: 'Back to current', categoryId: null });
    recordManyInAccount(v, [a.id, b.id], sav.id);
    recordInAccount(v, back.id, cur.id);
    addManual(v, { accountId: other.id, date: '2026-05-10', amount: -7000, description: 'Old account', categoryId: 'own_transfer' });
    addManual(v, { accountId: cur.id, date: '2026-04-10', amount: -9900, description: 'April', categoryId: 'own_transfer' });

    const all = transferFlows(v, ['2026-05']);
    expect(all.flows.map((f) => [f.fromId, f.toId, f.amount, f.count])).toEqual([
      [cur.id, sav.id, 25000, 2],
      [other.id, null, 7000, 1],
      [sav.id, cur.id, 3000, 1],
    ]);
    expect(all.total).toBe(35000);
    expect(transferFlows(v, ['2026-05'], { accountIds: [sav.id] }).total).toBe(28000);
    expect(transferFlows(v, ['2026-04', '2026-05'], { average: true }).total).toBe(Math.round(35000 / 2) + Math.round(9900 / 2));
    // Linked transfers are still in the operations, only left out of spending
    expect(monthlySummaries(v).find((m) => m.month === '2026-05')!.spending).toBe(0);
  });
});
