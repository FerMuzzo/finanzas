import { describe, expect, it } from 'vitest';
import { parseAmount, formatCents } from '../src/core/money';
import { decodeBytes, repairMojibake } from '../src/core/text';
import { inferShortDate, parseFrDate } from '../src/core/dates';
import { parseSgDetail } from '../src/core/importers/sgDetail';
import { commitImport, parseBankText, previewImport } from '../src/core/importService';
import { emptyVault } from '../src/core/model';
import { monthlySummaries } from '../src/core/summary';
import { sgRawBytes, sgSpreadsheetText, SG_ROWS } from './fixtures';

describe('money', () => {
  it('parses French amounts into cents', () => {
    expect(parseAmount('-845,00')).toBe(-84500);
    expect(parseAmount('1234,56 EUR')).toBe(123456);
    expect(parseAmount('1 234,56')).toBe(123456);
    expect(parseAmount('1.234,56')).toBe(123456);
    expect(parseAmount('40,00')).toBe(4000);
    expect(parseAmount('-1,29')).toBe(-129);
    expect(parseAmount('12')).toBe(1200);
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
  it('formats cents', () => {
    expect(formatCents(123456).replace(/\s/g, ' ')).toBe('1 234,56 €');
  });
});

describe('text and dates', () => {
  it('repairs mojibake', () => {
    expect(repairMojibake("Date de l'opÃ©ration")).toBe("Date de l'opération");
    expect(repairMojibake('Déjà bon')).toBe('Déjà bon');
  });
  it('decodes Windows 1252 bytes', () => {
    const bytes = new Uint8Array([0x44, 0xe9, 0x74, 0x61, 0x69, 0x6c]); // "Détail" in cp1252
    expect(decodeBytes(bytes)).toBe('Détail');
  });
  it('parses dates and infers card purchase year', () => {
    expect(parseFrDate('30/10/2026')).toBe('2026-10-30');
    expect(parseFrDate('31/02/2026')).toBeNull();
    expect(inferShortDate('29/10', '2026-10-30')).toBe('2026-10-29');
    expect(inferShortDate('30/12', '2027-01-02')).toBe('2026-12-30');
  });
});

describe('Société Générale detail parsing', () => {
  const p = (row: string[]) => parseSgDetail(row[1], row[2], parseFrDate(row[0])!, parseAmount(row[3])!);

  it('reads a standing order', () => {
    const d = p(SG_ROWS[0]);
    expect(d.opType).toBe('standing_order');
    expect(d.counterparty).toBe('Mme Dupont A et Mr Martin J');
    expect(d.motif).toBe('Loyer');
  });
  it('reads a salary transfer', () => {
    const d = p(SG_ROWS[11]);
    expect(d.opType).toBe('transfer_in');
    expect(d.counterparty).toBe('Acme - Agence Comptable Centre');
    expect(d.motif).toBe('ACME PAYE 202610');
  });
  it('reads an online card payment', () => {
    const d = p(SG_ROWS[2]);
    expect(d.opType).toBe('card');
    expect(d.counterparty).toBe('Asso Exemple');
    expect(d.online).toBe(true);
    expect(d.opDate).toBe('2026-10-29');
  });
  it('reads a foreign card payment with exchange rate', () => {
    const d = p(SG_ROWS[5]);
    expect(d.counterparty).toBe('Airport Shop Exemple');
    expect(d.foreign).toEqual({ amount: 2000, currency: 'USD', country: 'Canada', rate: 1.15 });
  });
  it('reads a euro payment abroad', () => {
    const d = p(SG_ROWS[7]);
    expect(d.counterparty).toBe('Cafe S.A. - Estacion de');
    expect(d.foreign?.country).toBe('Espagne');
  });
  it('reads the foreign card fee', () => {
    const d = p(SG_ROWS[3]);
    expect(d.opType).toBe('card_fee');
    expect(d.opDate).toBe('2026-10-27');
    expect(d.foreign?.currency).toBe('USD');
    const d2 = p(SG_ROWS[14]);
    expect(d2.foreign?.country).toBe('Etats-Unis D');
  });
  it('reads instant transfers and their channel', () => {
    const a = p(SG_ROWS[4]);
    expect(a.opType).toBe('instant_transfer_out');
    expect(a.counterparty).toBe('Paul Exemple');
    expect(a.channel).toBe('LOGITEL');
    const b = p(SG_ROWS[12]);
    expect(b.counterparty).toBe('Lea M');
    expect(b.channel).toBe('WERO');
  });
  it('reads a direct debit with creditor identifier', () => {
    const d = p(SG_ROWS[8]);
    expect(d.opType).toBe('direct_debit');
    expect(d.counterparty).toBe('Dgfip Impot');
    expect(d.creditorId).toBe('FR00ZZZ000001');
    expect(d.merchantKey).toBe('ICS FR00ZZZ000001');
  });
});

describe('Société Générale files', () => {
  it('parses the spreadsheet copied version', () => {
    const f = parseBankText(repairMojibake(sgSpreadsheetText()));
    expect(f.bank).toBe('sg');
    expect(f.rows.length).toBe(SG_ROWS.length);
    expect(f.announcedCount).toBe(SG_ROWS.length);
    expect(f.last4).toBe('9999');
    expect(f.periodStart).toBe('2026-05-03');
    expect(f.periodEnd).toBe('2026-10-30');
    expect(f.balance).toEqual({ date: '2026-10-30', amount: 98050, currency: 'EUR' });
    expect(f.rows[0]).toMatchObject({ date: '2026-10-30', amount: -84500, currency: 'EUR' });
    expect(f.warnings).toEqual([]);
  });

  it('parses the raw semicolon Windows 1252 version', () => {
    const v = emptyVault();
    const prev = previewImport(sgRawBytes(), 'export.csv', v);
    expect(prev.rows.length).toBe(SG_ROWS.length);
    expect(prev.parsed.last4).toBe('9999');
    expect(prev.integrityOk).toBe(true);
    expect(prev.rows[2].info.counterparty).toBe('Asso Exemple');
  });

  it('warns when the announced count does not match', () => {
    const f = parseBankText(sgSpreadsheetText(SG_ROWS, 304));
    expect(f.warnings[0]).toMatch(/304/);
  });

  it('imports once and detects duplicates on reimport, including overlapping files', () => {
    const v = emptyVault();
    const p1 = previewImport(sgRawBytes(), 'a.csv', v);
    const r1 = commitImport(p1, v);
    expect(r1.added).toBe(SG_ROWS.length);
    expect(v.accounts.length).toBe(1);
    expect(v.balances.length).toBe(1);

    const p2 = previewImport(new TextEncoder().encode(sgSpreadsheetText()), 'b.txt', v);
    expect(p2.account?.id).toBe(v.accounts[0].id);
    expect(p2.newCount).toBe(0);
    expect(p2.duplicateCount).toBe(SG_ROWS.length);

    const extra = [['31/10/2026', 'CARTE X1234 30/10', 'CARTE X1234 30/10 BOULANGERIE TEST 999999999999IOPD', '-3,10', 'EUR'], ...SG_ROWS.slice(0, 5)];
    const p3 = previewImport(sgRawBytes(extra), 'c.csv', v);
    expect(p3.newCount).toBe(1);
    commitImport(p3, v);
    expect(v.transactions.length).toBe(SG_ROWS.length + 1);
  });

  it('keeps identical operations on the same day as separate transactions', () => {
    const twice = [SG_ROWS[10], SG_ROWS[10]];
    const v = emptyVault();
    const r = commitImport(previewImport(sgRawBytes(twice), 'x.csv', v), v);
    expect(r.added).toBe(2);
    const again = previewImport(sgRawBytes(twice), 'x.csv', v);
    expect(again.newCount).toBe(0);
  });

  it('computes monthly totals', () => {
    const v = emptyVault();
    commitImport(previewImport(sgRawBytes(), 'a.csv', v), v);
    const [oct] = monthlySummaries(v);
    expect(oct.month).toBe('2026-10');
    expect(oct.income).toBe(3500 + 240000 + 15000);
    expect(oct.count).toBe(SG_ROWS.length);
  });
});
