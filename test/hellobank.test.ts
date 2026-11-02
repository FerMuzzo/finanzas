import { describe, expect, it } from 'vitest';
import { parseBankText, previewImport, commitImport } from '../src/core/importService';
import { parseHellobankDetail } from '../src/core/importers/hellobankDetail';
import { emptyVault } from '../src/core/model';
import { monthlySummaries } from '../src/core/summary';
import { HB_ROWS, hbText, sgRawBytes, SG_ROWS } from './fixtures';

const d = (i: number) => parseHellobankDetail(HB_ROWS[i][3], Math.round(Number(HB_ROWS[i][4]) * 100));

describe('Hello bank labels', () => {
  it('reads card payments', () => {
    const n = d(2);
    expect(n).toMatchObject({ opType: 'card', counterparty: 'Netflix', opDate: '2026-10-28', place: 'Amsterdam', cardLast4: '1111' });
    expect(d(8).counterparty).toBe('Chez Paul');
    expect(d(9).counterparty).toBe('Leclerc');
    expect(d(11).counterparty).toBe('hbomax.com');
  });
  it('reads direct debits', () => {
    const f = d(4);
    expect(f).toMatchObject({ opType: 'direct_debit', counterparty: 'Fitness Park', creditorId: 'FR00MON000002', merchantKey: 'ICS FR00MON000002' });
    expect(d(5)).toMatchObject({ counterparty: 'Dgfip Impot', creditorId: 'FR00ZZZ000001' });
    expect(d(10).counterparty).toBe('Sfr');
  });
  it('reads transfers received', () => {
    expect(d(0)).toMatchObject({ opType: 'transfer_in', counterparty: 'M. Jean Martin', motif: 'LOYER' });
    expect(d(1)).toMatchObject({ opType: 'transfer_in', counterparty: 'Mlle Anne Dupont' });
    expect(d(12).motif).toBe('REMBOURSEMENT');
  });
});

describe('Hello bank files', () => {
  for (const [name, text] of [
    ['tabs, dot decimals', hbText()],
    ['semicolons, comma decimals', hbText(HB_ROWS, ';', true)],
  ] as const) {
    it('parses ' + name, () => {
      const f = parseBankText(text);
      expect(f.bank).toBe('hellobank');
      expect(f.rows.length).toBe(HB_ROWS.length);
      expect(f.last4).toBe('8888');
      expect(f.balance).toEqual({ date: '2026-11-02', amount: 150000, currency: 'EUR' });
      expect(f.rows[0]).toMatchObject({ date: '2026-11-02', amount: 84500 });
      expect(f.rows[2]).toMatchObject({ amount: -1099, bankCategory: 'Abonnements et Telephonie', bankSubCategory: 'Internet, TV' });
    });
  }

  it('links the transfer from Société Générale and categorizes', () => {
    const v = emptyVault();
    commitImport(previewImport(sgRawBytes(), 'sg.csv', v), v);
    const r = commitImport(previewImport(new TextEncoder().encode(hbText()), 'hb.csv', v), v);
    expect(r.transfersLinked).toBe(1);
    const pair = v.transactions.filter((t) => Math.abs(t.amount) === 84500);
    expect(pair.every((t) => t.transferId && t.categoryId === 'own_transfer')).toBe(true);
    const by = (s: string) => v.transactions.find((t) => t.counterparty === s)!;
    expect(by('Netflix').categoryId).toBe('subscriptions');
    expect(by('hbomax.com').categoryId).toBe('subscriptions');
    expect(by('Le Petit Zinc').categoryId).toBe('eating_out');
    expect(by('Le Petit Zinc').catSource).toBe('bank');
    expect(by('Carrefour').categoryId).toBe('groceries');
    expect(by('Fitness Park').categoryId).toBe('leisure');
    expect(by('Sfr').categoryId).toBe('utilities');
    expect(v.transactions.filter((t) => t.counterparty === 'Dgfip Impot').every((t) => t.categoryId === 'taxes')).toBe(true);
    expect(v.transactions.find((t) => t.amount === 12000)!.categoryId).toBe('refunds');
    // SG side
    expect(by('Acme - Agence Comptable Centre').categoryId).toBe('salary');
    expect(v.transactions.find((t) => t.opType === 'card_fee')!.categoryId).toBe('bank_fees');
    expect(by('Airport Shop Exemple').categoryId).toBe('travel');
    const oct = monthlySummaries(v).find((m) => m.month === '2026-10')!;
    expect(oct.spending).toBeGreaterThan(0);
    expect(SG_ROWS.length).toBeGreaterThan(0);
  });
});
