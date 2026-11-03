// A savings account reached only through the current account: transfers recognized by the names
// shown on them and recorded in it automatically. Invented names and amounts.

import { describe, expect, it } from 'vitest';
import { commitImport, previewImport } from '../src/core/importService';
import { emptyVault, migrateVault, type VaultData } from '../src/core/model';
import { addAccount } from '../src/core/accounts';
import { addManual, deleteManual } from '../src/core/manual';
import { currentBalanceOf } from '../src/core/balances';
import { cleanNames, findMatches, setTransferNames } from '../src/core/ownTransfers';
import { unlinkTransfer } from '../src/core/transfers';
import { monthlySummaries } from '../src/core/summary';
import { SG_ROWS, sgRawBytes } from './fixtures';

const TO_SAVINGS = ['02/10/2026', '000001 VIR PERM', '000001 VIR PERM POUR: M. TEST PERSONNE REF: 900000000009 MOTIF: Epargne', '-300,00', 'EUR'];
const FROM_SAVINGS = ['20/10/2026', 'VIR RECU 500004444', 'VIR RECU 5000044444444 DE: M TEST PERSONNE MOTIF: Retour', '120,00', 'EUR'];
const TO_OTHER = ['21/10/2026', '000001 VIR INSTANT', '000001 VIR INSTANTANE EMIS LOGITEL POUR: TEST PERSONNE COMPTE JOINT DATE: 21/10/2026 10:00', '-50,00', 'EUR'];

function setup(rows = [...SG_ROWS, TO_SAVINGS, FROM_SAVINGS]): { v: VaultData; current: string; savings: string } {
  const v = migrateVault(emptyVault());
  commitImport(previewImport(sgRawBytes(rows), 'sg.csv', v), v);
  const current = v.accounts[0].id;
  const s = addAccount(v, { name: 'Livret A', bank: 'sg', type: 'savings', balance: 100000, balanceDate: '2026-09-30' });
  return { v, current, savings: s.id };
}

describe('transfer names of an account', () => {
  it('cleans the list of names', () => {
    expect(cleanNames('Test Personne\n test  personne , M. Test\n\n')).toEqual(['Test Personne', 'M. Test']);
  });

  it('records the matching transfers in the savings account and keeps its balance', () => {
    const { v, current, savings } = setup();
    const preview = findMatches(v, { accountId: savings, names: ['Test Personne'] });
    expect(preview.record.map((c) => c.t.amount).sort((a, b) => a - b)).toEqual([-30000, 12000]);

    const r = setTransferNames(v, savings, 'M. Test Personne');
    expect(r).toEqual({ added: 2, removed: 0 });
    const acc = v.accounts.find((a) => a.id === savings)!;
    expect(acc.transferNames).toEqual(['M. Test Personne']);
    const inSavings = v.transactions.filter((t) => t.accountId === savings);
    expect(inSavings.map((t) => t.amount).sort((a, b) => a - b)).toEqual([-12000, 30000]);
    expect(inSavings.every((t) => t.autoRecorded && t.transferId && t.source === 'manual')).toBe(true);
    expect(currentBalanceOf(v, acc)).toBe(100000 + 30000 - 12000);
    // the current account side is a transfer between your accounts, counted as saved
    const oct = monthlySummaries(v, [current]).find((m) => m.month === '2026-10')!;
    expect(oct.savings).toBe(30000 - 12000);
    expect(v.transactions.find((t) => t.detail.includes('Epargne'))!.categoryId).toBe('own_transfer');
  });

  it('records new imports automatically, without counting twice', () => {
    const { v, savings } = setup(SG_ROWS);
    setTransferNames(v, savings, 'Test Personne');
    expect(v.transactions.filter((t) => t.accountId === savings).length).toBe(0);
    const r = commitImport(previewImport(sgRawBytes([...SG_ROWS, TO_SAVINGS, FROM_SAVINGS]), 'sg2.csv', v), v);
    expect(r.added).toBe(2);
    expect(r.recordedElsewhere).toBe(2);
    commitImport(previewImport(sgRawBytes([...SG_ROWS, TO_SAVINGS, FROM_SAVINGS]), 'sg3.csv', v), v);
    expect(v.transactions.filter((t) => t.accountId === savings).length).toBe(2);
  });

  it('leaves alone a transfer that matches two accounts, and one you categorized as something else', () => {
    const { v, savings } = setup([...SG_ROWS, TO_SAVINGS, TO_OTHER]);
    const joint = addAccount(v, { name: 'Joint', bank: 'hellobank', type: 'checking' });
    v.accounts.find((a) => a.id === joint.id)!.transferNames = ['Compte joint']; // names set, nothing recorded yet
    // "Test Personne" alone matches the joint account transfer too
    const m = findMatches(v, { accountId: savings, names: ['Test Personne'] });
    expect(m.record.map((c) => [c.t.amount, c.target.name])).toEqual([[-30000, 'Livret A']]);
    expect(m.ambiguous.map((t) => t.amount)).toEqual([-5000]);
    const gift = v.transactions.find((t) => t.amount === -30000)!;
    gift.categoryId = 'gifts';
    gift.catSource = 'user';
    expect(findMatches(v, { accountId: savings, names: ['Test Personne'] }).record.length).toBe(0);
  });

  it('removes what no longer matches when the names change', () => {
    const { v, savings } = setup();
    setTransferNames(v, savings, 'Test Personne');
    const r = setTransferNames(v, savings, 'Epargne');
    expect(r).toEqual({ added: 0, removed: 1 });
    const left = v.transactions.filter((t) => t.accountId === savings);
    expect(left.map((t) => t.amount)).toEqual([30000]);
    const back = v.transactions.find((t) => t.detail.includes('Retour'))!;
    expect(back.transferId).toBeNull();
    expect(back.categoryId).not.toBe('own_transfer');
  });

  it('does not record again what you unlinked or deleted', () => {
    const { v, savings } = setup();
    setTransferNames(v, savings, 'Test Personne');
    const sent = v.transactions.find((t) => t.detail.includes('Epargne'))!;
    unlinkTransfer(v, sent.transferId!);
    expect(v.transactions.filter((t) => t.accountId === savings).length).toBe(1);
    const mirror = v.transactions.find((t) => t.accountId === savings)!;
    deleteManual(v, mirror.id);
    expect(v.transactions.filter((t) => t.accountId === savings).length).toBe(0);
    commitImport(previewImport(sgRawBytes([...SG_ROWS, TO_SAVINGS, FROM_SAVINGS]), 'again.csv', v), v);
    expect(v.transactions.filter((t) => t.accountId === savings).length).toBe(0);
  });

  it('records an operation added by hand when it carries the name', () => {
    const { v, current, savings } = setup(SG_ROWS);
    setTransferNames(v, savings, 'Livret');
    addManual(v, { accountId: current, date: '2026-10-31', amount: -2000, description: 'To my livret', categoryId: null });
    expect(v.transactions.filter((t) => t.accountId === savings).map((t) => t.amount)).toEqual([2000]);
  });
});
