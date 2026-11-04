// Several operations categorized at once, and what money sent to another everyday account paid for.
// Invented names and amounts.

import { describe, expect, it } from 'vitest';
import { emptyVault, migrateVault, type VaultData } from '../src/core/model';
import { addAccount, recordInAccount } from '../src/core/accounts';
import { addManual, ensureCashAccount } from '../src/core/manual';
import { setCategoryForMany } from '../src/core/categorize';
import { fundedSpending, spendingByCategory, withFunded } from '../src/core/summary';

function vault(): VaultData {
  return migrateVault(emptyVault());
}

const add = (v: VaultData, accountId: string, date: string, amount: number, description: string, categoryId: string | null = null) =>
  addManual(v, { accountId, date, amount, description, categoryId });

describe('several operations at once', () => {
  it('sets the category, remembers the merchants and lets others of the same merchants follow', () => {
    const v = vault();
    const a = addAccount(v, { name: 'Current', bank: 'other', type: 'checking' });
    const x = add(v, a.id, '2026-10-01', -1200, 'Chez Test Lili');
    const y = add(v, a.id, '2026-10-02', -800, 'Fromagerie test');
    const z = add(v, a.id, '2026-10-09', -950, 'Chez Test Lili');
    const mine = add(v, a.id, '2026-10-10', -500, 'Chez Test Lili', 'eating_out');
    const r = setCategoryForMany(v, [x.id, y.id], 'groceries');
    expect(r).toEqual({ set: 2, others: 1 });
    const get = (id: string) => v.transactions.find((t) => t.id === id)!;
    expect([get(x.id).categoryId, get(y.id).categoryId, get(z.id).categoryId]).toEqual(['groceries', 'groceries', 'groceries']);
    expect(get(x.id).catSource).toBe('user');
    expect(get(z.id).catSource).toBe('memory');
    expect(get(mine.id).categoryId).toBe('eating_out'); // your earlier choice stays
  });
});

describe('spending paid through another of your accounts', () => {
  function setup() {
    const v = vault();
    const sg = addAccount(v, { name: 'Current', bank: 'sg', type: 'checking' });
    const hb = addAccount(v, { name: 'Shared', bank: 'hellobank', type: 'checking' });
    const sent = add(v, sg.id, '2026-10-01', -50000, 'To shared account', 'own_transfer');
    recordInAccount(v, sent.id, hb.id);
    add(v, hb.id, '2026-10-02', 50000, 'From partner', 'other_income');
    add(v, hb.id, '2026-10-05', -60000, 'Supermarket', 'groceries');
    add(v, hb.id, '2026-10-12', -20000, 'Restaurant', 'eating_out');
    add(v, sg.id, '2026-10-15', -3000, 'Bakery', 'groceries');
    return { v, sg: sg.id, hb: hb.id };
  }

  it('shares the spending of the receiving account in proportion to the money it got', () => {
    const { v, sg, hb } = setup();
    const f = fundedSpending(v, ['2026-10'], [sg]);
    expect(f.length).toBe(1);
    expect(f[0]).toMatchObject({ accountId: hb, transferred: 50000, used: 40000 }); // half of what came in
    expect(Object.fromEntries(f[0].byCategory)).toEqual({ groceries: 30000, eating_out: 10000 });
    const cats = withFunded(spendingByCategory(v, ['2026-10'], { accountIds: [sg] }), f);
    expect(cats.map((c) => [c.categoryId, c.amount, c.via.map((x) => x.amount)])).toEqual([
      ['groceries', 33000, [30000]],
      ['eating_out', 10000, [10000]],
    ]);
  });

  it('never counts more than was sent, nor more than was spent', () => {
    const { v, sg } = setup();
    // the partner's money removed: everything came from the current account, but spending is larger
    v.transactions = v.transactions.filter((t) => t.counterparty !== 'From partner');
    const f = fundedSpending(v, ['2026-10'], [sg]);
    expect(f[0].used).toBe(50000);
    expect(Object.fromEntries(f[0].byCategory)).toEqual({ groceries: 37500, eating_out: 12500 });
    // nothing spent there: nothing counted, the transfer stays visible
    const quiet = fundedSpending(v, ['2026-09'], [sg]);
    expect(quiet).toEqual([]);
  });

  it('counts cash spending paid with a withdrawal, and nothing for savings', () => {
    const v = vault();
    const sg = addAccount(v, { name: 'Current', bank: 'sg', type: 'checking' });
    const cash = ensureCashAccount(v);
    const w = add(v, sg.id, '2026-10-03', -10000, 'Cash', 'own_transfer');
    v.transactions.find((t) => t.id === w.id)!.opType = 'cash_withdrawal';
    add(v, cash.id, '2026-10-04', -6000, 'Market', 'groceries');
    const liv = addAccount(v, { name: 'Livret', bank: 'sg', type: 'savings' });
    const s = add(v, sg.id, '2026-10-05', -20000, 'To livret');
    recordInAccount(v, s.id, liv.id);
    const f = fundedSpending(v, ['2026-10'], [sg.id]);
    expect(f.map((x) => [x.accountId, x.transferred, x.used])).toEqual([[cash.id, 10000, 6000]]);
  });

  it('nets money that came back and works out a monthly average', () => {
    const { v, sg, hb } = setup();
    const back = add(v, hb, '2026-10-20', -10000, 'Back to current', 'own_transfer');
    recordInAccount(v, back.id, sg);
    const f = fundedSpending(v, ['2026-09', '2026-10'], [sg], true);
    expect(f[0].transferred).toBe(20000); // (50000 minus 10000) over two months
    expect(f[0].used).toBe(16000); // 40000 of the 100000 that came in pays 40% of the 80000 spent, averaged
  });
});
